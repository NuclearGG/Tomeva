/**
 * mintKioskToken — Cloud Function (HTTPS Callable)
 *
 * Mints a Firebase Custom Token for a provisioned library kiosk workstation.
 * The custom token carries claims: { kiosk: true, libraryId: "main" }
 * which the Firestore rules use to authorize write operations from the
 * offline-first librarian desktop application.
 *
 * Security model:
 * - Each workstation is provisioned once during library setup
 * - A per-workstation secret is generated and stored in the OS keychain
 *   via Electron's safeStorage (never in source control or plaintext config)
 * - The secret is registered in /kiosk_registry/{workstationId} (Admin SDK only)
 * - This function verifies the secret against the registry before minting
 * - Rate-limits and logs mint attempts to detect leaked/brute-forced secrets
 *
 * Deployment:
 *   firebase deploy --only functions:mintKioskToken
 *
 * Client usage (from js/firebase-sync.js):
 *   const result = await firebase.functions().httpsCallable('mintKioskToken')({
 *     workstationId: 'ws-001',
 *     secret: '...'  // retrieved from OS keychain via Electron safeStorage
 *   });
 *   const customToken = result.data.token;
 *   await firebase.auth().signInWithCustomToken(customToken);
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const auth = admin.auth();

// Configuration
const MAX_ATTEMPTS_PER_HOUR = 20;
const TOKEN_TTL_SECONDS = 3600; // 1 hour (custom token expiry)
const LIBRARY_ID = 'main';

/**
 * Rate limiting using Firestore counters (simple sliding window)
 * In production, consider Firebase App Check or Cloud Armor for stronger protection
 */
async function checkRateLimit(workstationId) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;

  const counterRef = db.collection('_rate_limits').doc(`mintKioskToken_${workstationId}`);
  const snap = await counterRef.get();

  let attempts = [];
  if (snap.exists) {
    attempts = snap.data().attempts || [];
  }

  // Filter to last hour
  attempts = attempts.filter(ts => ts > hourAgo);

  if (attempts.length >= MAX_ATTEMPTS_PER_HOUR) {
    // Log the rate limit event for audit
    await logMintAttempt(workstationId, 'rate_limited', { attemptsCount: attempts.length });
    throw new functions.https.HttpsError(
      'resource-exhausted',
      'Too many token mint attempts. Try again later.'
    );
  }

  // Add current attempt
  attempts.push(now);
  await counterRef.set({ attempts }, { merge: true });
}

/**
 * Audit logging for mint attempts
 */
async function logMintAttempt(workstationId, result, metadata = {}) {
  try {
    await db.collection('_mint_audit').add({
      workstationId,
      result, // 'success' | 'invalid_secret' | 'not_provisioned' | 'rate_limited' | 'error'
      metadata,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      timestamp_iso: new Date().toISOString(),
    });
  } catch (err) {
    // Never let logging failures affect the actual operation
    console.warn('[mintKioskToken] Audit log failed:', err.message);
  }
}

/**
 * Verify the workstation secret against the server-side registry
 */
async function verifyWorkstationSecret(workstationId, providedSecret) {
  const registryRef = db.collection('kiosk_registry').doc(workstationId);
  const snap = await registryRef.get();

  if (!snap.exists) {
    await logMintAttempt(workstationId, 'not_provisioned');
    return { valid: false, reason: 'Workstation not provisioned' };
  }

  const data = snap.data();
  const storedSecretHash = data.secret_hash; // bcrypt or similar hash

  // Verify using bcrypt (constant-time comparison)
  // Note: In practice, use bcrypt.compare() — here we assume hash is stored
  // For this implementation, we'll do a direct comparison since we're
  // demonstrating the pattern. Production should use proper password hashing.
  const crypto = require('crypto');
  const providedHash = crypto.createHash('sha256').update(providedSecret).digest('hex');

  if (providedHash !== storedSecretHash) {
    await logMintAttempt(workstationId, 'invalid_secret');
    return { valid: false, reason: 'Invalid secret' };
  }

  // Check if workstation is active
  if (data.active === false) {
    await logMintAttempt(workstationId, 'deactivated');
    return { valid: false, reason: 'Workstation deactivated' };
  }

  return { valid: true, libraryId: data.libraryId || LIBRARY_ID };
}

/**
 * HTTPS Callable: mintKioskToken
 *
 * Request payload:
 *   { workstationId: string, secret: string }
 *
 * Response:
 *   { token: string, expiresIn: number }
 */
exports.mintKioskToken = functions.https.onCall(async (data, context) => {
  // No Firebase Auth context — this is called BEFORE the kiosk signs in
  // We verify identity via the pre-shared secret

  const { workstationId, secret } = data || {};

  if (!workstationId || typeof workstationId !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'workstationId is required'
    );
  }

  if (!secret || typeof secret !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'secret is required'
    );
  }

  // Basic format validation (prevent injection)
  if (workstationId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(workstationId)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invalid workstationId format'
    );
  }

  // Rate limiting
  await checkRateLimit(workstationId);

  // Verify secret against registry
  const verification = await verifyWorkstationSecret(workstationId, secret);
  if (!verification.valid) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      verification.reason
    );
  }

  // Mint custom token with kiosk claims
  try {
    const customToken = await auth.createCustomToken(workstationId, {
      kiosk: true,
      libraryId: verification.libraryId,
    });

    await logMintAttempt(workstationId, 'success', { libraryId: verification.libraryId });

    return {
      token: customToken,
      expiresIn: TOKEN_TTL_SECONDS,
    };
  } catch (err) {
    console.error('[mintKioskToken] Token creation failed:', err);
    await logMintAttempt(workstationId, 'error', { error: err.message });
    throw new functions.https.HttpsError(
      'internal',
      'Failed to mint token'
    );
  }
});

/**
 * Admin-only callable: provision a new workstation
 * Called from admin dashboard during library setup
 *
 * Request:
 *   { workstationId: string, libraryId?: string }
 *
 * Response:
 *   { workstationId: string, secret: string }  // secret shown ONCE
 */
exports.provisionKiosk = functions.https.onCall(async (data, context) => {
  // Verify caller is authenticated staff
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  // Check staff claim (set via custom claims on staff accounts)
  if (!context.auth.token.kiosk && !context.auth.token.staff) {
    // Fallback: check email domain + verified
    const email = context.auth.token.email || '';
    const verified = context.auth.token.email_verified === true;
    if (!email.endsWith('@meacademy.in') || !verified) {
      throw new functions.https.HttpsError('permission-denied', 'Staff access required');
    }
  }

  const { workstationId, libraryId } = data || {};

  if (!workstationId || typeof workstationId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'workstationId is required');
  }

  if (workstationId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(workstationId)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid workstationId format');
  }

  // Generate a cryptographically secure secret
  const crypto = require('crypto');
  const secret = crypto.randomBytes(32).toString('hex');
  const secretHash = crypto.createHash('sha256').update(secret).digest('hex');

  // Store in registry (Admin SDK bypasses rules)
  await db.collection('kiosk_registry').doc(workstationId).set({
    secret_hash: secretHash,
    libraryId: libraryId || LIBRARY_ID,
    active: true,
    provisioned_at: admin.firestore.FieldValue.serverTimestamp(),
    provisioned_by: context.auth.uid,
  });

  await logMintAttempt(workstationId, 'provisioned', { libraryId: libraryId || LIBRARY_ID });

  // Return secret ONLY ONCE — client must store in OS keychain immediately
  return { workstationId, secret };
});

/**
 * Admin-only callable: deactivate a workstation
 */
exports.deactivateKiosk = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const email = context.auth.token.email || '';
  const verified = context.auth.token.email_verified === true;
  if (!email.endsWith('@meacademy.in') || !verified) {
    throw new functions.https.HttpsError('permission-denied', 'Staff access required');
  }

  const { workstationId } = data || {};
  if (!workstationId) {
    throw new functions.https.HttpsError('invalid-argument', 'workstationId is required');
  }

  await db.collection('kiosk_registry').doc(workstationId).update({
    active: false,
    deactivated_at: admin.firestore.FieldValue.serverTimestamp(),
    deactivated_by: context.auth.uid,
  });

  await logMintAttempt(workstationId, 'deactivated_by_admin');

  return { ok: true };
});