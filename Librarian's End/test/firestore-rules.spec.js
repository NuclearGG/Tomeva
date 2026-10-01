/**
 * Firestore Rules Test Suite — Tomeva Library Management System
 *
 * Run with: npm run test:rules
 * Requires: Firebase Emulator Suite running on port 8080
 *   firebase emulators:start --only firestore
 *
 * Coverage (per Prompt 9 requirements, REVISED auth split):
 * 1. /libraries/{libraryId} — aggregate sync relaxed to ANY auth (incl. anonymous);
 *    denied only for unauthenticated (request.auth == null); schema checks remain
 * 2. /libraries/{libraryId}/meta/control — staff-only; denied for kiosk AND anonymous
 * 3. /book_requests/{requestId} — anonymous cannot set Approved/Declined/Issued/Cancelled;
 *    student cannot self-approve/issue; can cancel own pending;
 *    student cannot modify another's request; staff/kiosk can set valid status transitions
 * 4. /libraries/{libraryId}/public/catalog — readable by anyone; writable by any auth
 * 5. /libraries/{libraryId}/restricted/circulation — denied for unauth/anonymous/non-staff;
 *    readable by isStaff(); writable by staff/kiosk only
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} = require('@firebase/rules-unit-testing');
const { Timestamp } = require('firebase/firestore');

const PROJECT_ID = 'demo-tomeva';
const LIBRARY_ID = 'main';

let testEnv;

/**
 * Helper: create authenticated context with custom claims
 */
function auth(claims = {}) {
  return testEnv.authenticatedContext('user-' + Date.now(), claims);
}

/**
 * Helper: create unauthenticated context
 */
function unauth() {
  return testEnv.unauthenticatedContext();
}

/**
 * Helper: anonymous session (what firebase.auth().signInAnonymously()
 * produces — request.auth != null, but NO email / kiosk claims).
 * Used for aggregate sync; must NOT unlock privileged paths.
 */
function anonymous(overrides = {}) {
  return auth({ ...overrides });
}

/**
 * Helper: create a staff user (verified @staff.example)
 */
function staff(overrides = {}) {
  return auth({
    email: 'librarian@staff.example',
    email_verified: true,
    ...overrides,
  });
}

/**
 * Helper: create a kiosk user (custom token with kiosk: true)
 */
function kiosk(overrides = {}) {
  return testEnv.authenticatedContext('kiosk-main', {
    email: 'kiosk-' + 'a'.repeat(32) + '@kiosk.tomeva.invalid',
    firebase: { sign_in_provider: 'password' },
    ...overrides,
  });
}

/**
 * Helper: create a non-staff user (unverified or wrong domain)
 */
function nonStaff(overrides = {}) {
  return auth({
    email: 'student@gmail.com',
    email_verified: false,
    ...overrides,
  });
}

/**
 * Helper: create a verified non-staff user (wrong domain)
 */
function verifiedNonStaff(overrides = {}) {
  return auth({
    email: 'student@example.org',
    email_verified: true,
    ...overrides,
  });
}

/**
 * Helper: create an unverified staff-domain user
 */
function unverifiedStaff(overrides = {}) {
  return auth({
    email: 'teacher@staff.example',
    email_verified: false,
    ...overrides,
  });
}

/**
 * Helper: create a verified staff-domain user
 */
function verifiedStaff(overrides = {}) {
  return auth({
    email: 'teacher@staff.example',
    email_verified: true,
    ...overrides,
  });
}

/**
 * Build a valid sync payload for write tests
 */
function buildValidSyncPayload(overrides = {}) {
  const now = Timestamp.now();
  return {
    stats: {
      total_books: 100,
      available: 80,
      issued: 15,
      damaged: 3,
      under_repair: 1,
      lost: 1,
    },
    issuedList: [],
    damagedList: [],
    availableList: [],
    last_synced: now,
    last_synced_iso: new Date().toISOString(),
    sync_version: 6,
    ...overrides,
  };
}

/**
 * Build a valid control document
 */
function buildControlDoc(overrides = {}) {
  return {
    issuance_suspended: false,
    suspend_reason: '',
    updated_at: Timestamp.now(),
    updated_by: 'admin',
    ...overrides,
  };
}

/**
 * Build a valid book request
 */
function buildBookRequest(overrides = {}) {
  return {
    adm_no: 'ADM001',
    student_name: 'Test Student',
    class: '10',
    section: 'A',
    group: 'Regular',
    book_access_no: 'BOOK001',
    book_title: 'Test Book',
    priority: false,
    note: '',
    status: 'Pending',
    timestamp: Timestamp.now(),
    timestamp_iso: new Date().toISOString(),
    requester_email: 'student@gmail.com',
    ...overrides,
  };
}

describe('Tomeva Firestore Rules', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: require('fs').readFileSync('firestore.rules', 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('kiosk_accounts/kiosk-main').set({
        email: 'kiosk-' + 'a'.repeat(32) + '@kiosk.tomeva.invalid',
        libraryId: LIBRARY_ID, active: true,
      });
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     1. /libraries/{libraryId} — Main sync document write permissions
  ═══════════════════════════════════════════════════════════════════ */

  describe('/libraries/{libraryId} write permissions (REVISED: relaxed to any auth)', () => {
    const validPayload = buildValidSyncPayload();

    test('DENY: unauthenticated write (request.auth == null)', async () => {
      const db = unauth().firestore();
      await assertFails(db.collection('libraries').doc(LIBRARY_ID).set(validPayload));
    });

    test('ALLOW: anonymous session can write aggregate sync', async () => {
      const db = anonymous().firestore();
      await assertSucceeds(db.collection('libraries').doc(LIBRARY_ID).set(validPayload));
    });

    test('ALLOW: non-staff domain can write aggregate sync (no PII here)', async () => {
      const db = verifiedNonStaff().firestore();
      await assertSucceeds(db.collection('libraries').doc(LIBRARY_ID).set(validPayload));
    });

    test('ALLOW: unverified staff-domain email can write aggregate sync', async () => {
      const db = unverifiedStaff().firestore();
      await assertSucceeds(db.collection('libraries').doc(LIBRARY_ID).set(validPayload));
    });

    test('ALLOW: verified staff (@staff.example + email_verified)', async () => {
      const db = verifiedStaff().firestore();
      await assertSucceeds(db.collection('libraries').doc(LIBRARY_ID).set(validPayload));
    });

    test('ALLOW: kiosk with custom claim {kiosk: true}', async () => {
      const db = kiosk().firestore();
      await assertSucceeds(db.collection('libraries').doc(LIBRARY_ID).set(validPayload));
    });

    test('DENY: write with forbidden keys (student_personal_data)', async () => {
      const db = anonymous().firestore();
      const badPayload = buildValidSyncPayload({ student_personal_data: 'evil' });
      await assertFails(db.collection('libraries').doc(LIBRARY_ID).set(badPayload));
    });

    test('DENY: circulation rows in the public root', async () => {
      const db = anonymous().firestore();
      await assertFails(db.collection('libraries').doc(LIBRARY_ID).set(
        buildValidSyncPayload({ overdueList: [{ student_name: 'Private' }] })
      ));
    });

    test('DENY: financial stats in the public root', async () => {
      const db = anonymous().firestore();
      const payload = buildValidSyncPayload();
      payload.stats.collected_total = 5000;
      await assertFails(db.collection('libraries').doc(LIBRARY_ID).set(payload));
    });

    test('DENY: anonymous read of a legacy root containing older PII', async () => {
      const db = anonymous().firestore();
      await assertFails(db.collection('libraries').doc(LIBRARY_ID).get());
    });

    test('ALLOW: verified staff read of the legacy root', async () => {
      const db = verifiedStaff().firestore();
      await assertSucceeds(db.collection('libraries').doc(LIBRARY_ID).get());
    });

    test('DENY: write with missing required keys', async () => {
      const db = anonymous().firestore();
      const badPayload = { stats: {}, sync_version: 6 }; // missing catalog lists and timestamps
      await assertFails(db.collection('libraries').doc(LIBRARY_ID).set(badPayload));
    });

    test('DENY: delete (even for kiosk)', async () => {
      const db = kiosk().firestore();
      await assertFails(db.collection('libraries').doc(LIBRARY_ID).delete());
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     2. /libraries/{libraryId}/meta/control — Control flag permissions
  ═══════════════════════════════════════════════════════════════════ */

  describe('/libraries/{libraryId}/meta/control write permissions', () => {
    const validControl = buildControlDoc();

    test('DENY: unauthenticated write', async () => {
      const db = unauth().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('meta').doc('control').set(validControl)
      );
    });

    test('DENY: kiosk token (kiosk explicitly excluded)', async () => {
      const db = kiosk().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('meta').doc('control').set(validControl)
      );
    });

    test('DENY: anonymous session (REVISED — staff-only regardless of auth type)', async () => {
      const db = anonymous().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('meta').doc('control').set(validControl)
      );
    });

    test('DENY: non-staff', async () => {
      const db = nonStaff().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('meta').doc('control').set(validControl)
      );
    });

    test('ALLOW: verified staff', async () => {
      const db = verifiedStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('meta').doc('control').set(validControl)
      );
    });

    test('DENY: invalid updated_by (not "admin")', async () => {
      const db = verifiedStaff().firestore();
      const badControl = buildControlDoc({ updated_by: 'librarian' });
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('meta').doc('control').set(badControl)
      );
    });

    test('DENY: suspend_reason too long', async () => {
      const db = verifiedStaff().firestore();
      const badControl = buildControlDoc({ suspend_reason: 'x'.repeat(201) });
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('meta').doc('control').set(badControl)
      );
    });

    test('ALLOW: read by anyone (unauthenticated)', async () => {
      const db = unauth().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('meta').doc('control').get()
      );
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     3. /book_requests/{requestId} — Book request permissions
  ═══════════════════════════════════════════════════════════════════ */

  describe('/book_requests/{requestId} permissions', () => {
    const requestId = 'req-123';
    const studentEmail = 'student@example.org';
    const staffEmail = 'teacher@staff.example';

    // Setup: create a request as a student
    async function createRequestAsStudent(db, overrides = {}) {
      const req = buildBookRequest({
        requester_email: studentEmail,
        ...overrides,
      });
      return db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).set(req);
    }

    // Create a request directly via admin (for testing updates)
    async function seedRequest(db, data) {
      return db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).set(data);
    }

    describe('CREATE', () => {
      test('ALLOW: verified student with matching authorized_students group', async () => {
        const db = auth({
          email: studentEmail,
          email_verified: true,
        }).firestore();

        // Pre-seed authorized_students (normally done by admin)
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await ctx.firestore()
            .collection('libraries').doc(LIBRARY_ID)
            .collection('authorized_students').doc(studentEmail)
            .set({ email: studentEmail, name: 'Test Student', group: 'Regular', added_by: 'admin', added_at: Timestamp.now() });
        });

        await assertSucceeds(createRequestAsStudent(db));
      });

      test('DENY: student requester_email mismatch', async () => {
        const db = auth({
          email: studentEmail,
          email_verified: true,
        }).firestore();

        await assertFails(createRequestAsStudent(db, { requester_email: 'other@gmail.com' }));
      });

      test('DENY: student not in authorized_students', async () => {
        const db = auth({
          email: 'unauthorized@gmail.com',
          email_verified: true,
        }).firestore();

        await assertFails(createRequestAsStudent(db, { requester_email: 'unauthorized@gmail.com' }));
      });

      test('ALLOW: staff (auto-verified by domain)', async () => {
        const db = verifiedStaff().firestore();
        await assertSucceeds(createRequestAsStudent(db, {
          requester_email: staffEmail,
          group: 'Staff',
          priority: true,
        }));
      });

      test('DENY: staff with group != Staff', async () => {
        const db = verifiedStaff().firestore();
        await assertFails(createRequestAsStudent(db, {
          requester_email: staffEmail,
          group: 'Regular',
          priority: true,
        }));
      });

      test('ALLOW: priority group student (Literary Club)', async () => {
        const db = auth({
          email: 'club@gmail.com',
          email_verified: true,
        }).firestore();

        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await ctx.firestore()
            .collection('libraries').doc(LIBRARY_ID)
            .collection('authorized_students').doc('club@gmail.com')
            .set({ email: 'club@gmail.com', name: 'Club Member', group: 'Literary Club', added_by: 'admin', added_at: Timestamp.now() });
        });

        await assertSucceeds(createRequestAsStudent(db, {
          requester_email: 'club@gmail.com',
          group: 'Literary Club',
          priority: true,
        }));
      });
    });

    describe('UPDATE — Staff/Kiosk full transitions', () => {
      let baseRequest;

      beforeEach(async () => {
        baseRequest = buildBookRequest({ requester_email: studentEmail });
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await seedRequest(ctx.firestore(), baseRequest);
        });
      });

      test('ALLOW: kiosk can set Approved', async () => {
        const db = kiosk().firestore();
        await assertSucceeds(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Approved',
            decision_note: 'OK',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('ALLOW: kiosk can set Declined', async () => {
        const db = kiosk().firestore();
        await assertSucceeds(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Declined',
            decision_note: 'Not available',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('ALLOW: kiosk can set Issued', async () => {
        const db = kiosk().firestore();
        await assertSucceeds(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Issued',
            decision_note: 'Issued',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('ALLOW: verified staff can set Approved', async () => {
        const db = verifiedStaff().firestore();
        await assertSucceeds(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Approved',
            decision_note: 'OK',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('DENY: kiosk cannot modify other fields', async () => {
        const db = kiosk().firestore();
        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Approved',
            adm_no: 'HACKED', // forbidden field
          })
        );
      });

      // REVISED (auth split): an anonymous session has no email claim, so a
      // student who calls signInAnonymously() in the search-portal console must
      // NOT be able to approve/issue their own request. Explicit regression
      // tests for the PRB-02 hole.
      test('DENY: anonymous cannot set Approved (REVISED)', async () => {
        const db = anonymous().firestore();
        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Approved',
            decision_note: 'self-approval attempt',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('DENY: anonymous cannot set Issued (REVISED)', async () => {
        const db = anonymous().firestore();
        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Issued',
            decision_note: 'self-issue attempt',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('DENY: anonymous cannot set Declined (REVISED)', async () => {
        const db = anonymous().firestore();
        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Declined',
            decision_note: 'anonymous attempt',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('DENY: anonymous cannot cancel either (no email claim to match)', async () => {
        const db = anonymous().firestore();
        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Cancelled',
            decision_note: 'anonymous attempt',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });
    });

    describe('UPDATE — Student self-service (only cancel own pending)', () => {
      let baseRequest;

      beforeEach(async () => {
        baseRequest = buildBookRequest({ requester_email: studentEmail });
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await seedRequest(ctx.firestore(), baseRequest);
        });
      });

      test('ALLOW: student cancels own pending request', async () => {
        const db = auth({
          email: studentEmail,
          email_verified: true,
        }).firestore();

        await assertSucceeds(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Cancelled',
            decision_note: 'Changed my mind',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('DENY: student cannot approve own request', async () => {
        const db = auth({
          email: studentEmail,
          email_verified: true,
        }).firestore();

        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Approved',
            decision_note: 'Hack attempt',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('DENY: student cannot issue own request', async () => {
        const db = auth({
          email: studentEmail,
          email_verified: true,
        }).firestore();

        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Issued',
            decision_note: 'Hack attempt',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('DENY: student cannot decline own request', async () => {
        const db = auth({
          email: studentEmail,
          email_verified: true,
        }).firestore();

        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Declined',
            decision_note: 'Hack attempt',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('DENY: student cannot modify another student\'s request', async () => {
        const db = auth({
          email: 'other@gmail.com',
          email_verified: true,
        }).firestore();

        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Cancelled',
            decision_note: 'Hack attempt',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });

      test('DENY: student cannot cancel already-approved request', async () => {
        // Pre-seed as Approved
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await seedRequest(ctx.firestore(), { ...baseRequest, status: 'Approved' });
        });

        const db = auth({
          email: studentEmail,
          email_verified: true,
        }).firestore();

        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).update({
            status: 'Cancelled',
            decision_note: 'Too late',
            decided_at: Timestamp.now(),
            decided_at_iso: new Date().toISOString(),
          })
        );
      });
    });

    describe('DELETE', () => {
      test('DENY: student cannot delete', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await seedRequest(ctx.firestore(), buildBookRequest());
        });

        const db = auth({
          email: studentEmail,
          email_verified: true,
        }).firestore();

        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).delete()
        );
      });

      test('ALLOW: verified staff can delete', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await seedRequest(ctx.firestore(), buildBookRequest());
        });

        const db = verifiedStaff().firestore();
        await assertSucceeds(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).delete()
        );
      });
    });

    describe('READ', () => {
      test('DENY: unauthenticated users cannot read private requests', async () => {
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await seedRequest(ctx.firestore(), buildBookRequest());
        });

        const db = unauth().firestore();
        await assertFails(
          db.collection('libraries').doc(LIBRARY_ID).collection('book_requests').doc(requestId).get()
        );
      });
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     4. /libraries/{libraryId}/public/catalog — Public read
  ═══════════════════════════════════════════════════════════════════ */

  describe('/libraries/{libraryId}/public/catalog', () => {
    test('ALLOW: read by unauthenticated', async () => {
      const db = unauth().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('public').doc('catalog').get()
      );
    });

    test('ALLOW: read by any authenticated user', async () => {
      const db = nonStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('public').doc('catalog').get()
      );
    });

    test('ALLOW: write by anonymous session (aggregate sync, REVISED)', async () => {
      const db = anonymous().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('public').doc('catalog').set(buildValidSyncPayload())
      );
    });

    test('ALLOW: write by kiosk', async () => {
      const db = kiosk().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('public').doc('catalog').set(buildValidSyncPayload())
      );
    });

    test('DENY: write by unauthenticated (request.auth == null)', async () => {
      const db = unauth().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('public').doc('catalog').set(buildValidSyncPayload())
      );
    });

    test('DENY: public catalog containing borrower data', async () => {
      const db = anonymous().firestore();
      await assertFails(db.collection('libraries').doc(LIBRARY_ID).collection('public').doc('catalog').set(
        buildValidSyncPayload({ recentCollections: [{ student_name: 'Private' }] })
      ));
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     5. /libraries/{libraryId}/restricted/circulation — Staff-only read
  ═══════════════════════════════════════════════════════════════════ */

  describe('/libraries/{libraryId}/restricted/circulation', () => {
    test('DENY: read by unauthenticated', async () => {
      const db = unauth().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation').get()
      );
    });

    test('DENY: read by non-staff', async () => {
      const db = nonStaff().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation').get()
      );
    });

    test('DENY: read by verified non-staff (wrong domain)', async () => {
      const db = verifiedNonStaff().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation').get()
      );
    });

    test('ALLOW: read by verified staff', async () => {
      const db = verifiedStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation').get()
      );
    });

    test('ALLOW: write by kiosk', async () => {
      const db = kiosk().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation').set({
          overdueList: [],
          issuedList: [],
          finesList: [],
          recentCollections: [],
          last_synced: Timestamp.now(),
          last_synced_iso: new Date().toISOString(),
          sync_version: 4,
        })
      );
    });

    test('ALLOW: write by verified staff', async () => {
      const db = verifiedStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation').set({
          overdueList: [],
          issuedList: [],
          finesList: [],
          recentCollections: [],
          last_synced: Timestamp.now(),
          last_synced_iso: new Date().toISOString(),
          sync_version: 4,
        })
      );
    });

    test('DENY: write by non-staff', async () => {
      const db = nonStaff().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation').set({})
      );
    });

    test('DENY: write by anonymous session (PII stays gated, REVISED)', async () => {
      const db = anonymous().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation').set({
          overdueList: [],
          issuedList: [],
          finesList: [],
          recentCollections: [],
          last_synced: Timestamp.now(),
          last_synced_iso: new Date().toISOString(),
          sync_version: 4,
        })
      );
    });

    test('DENY: read by anonymous session', async () => {
      const db = anonymous().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('restricted').doc('circulation').get()
      );
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     6. Notifications — Librarian→Admin and Admin→Librarian
  ═══════════════════════════════════════════════════════════════════ */

  describe('Notifications permissions', () => {
    const validNotif = {
      from: 'librarian',
      to: 'admin',
      type: 'MESSAGE',
      subject: 'Test',
      body: 'Test body',
      read: false,
      timestamp: Timestamp.now(),
      timestamp_iso: new Date().toISOString(),
    };

    const validAdminNotif = {
      from: 'admin',
      to: 'librarian',
      type: 'ALERT',
      subject: 'Alert',
      body: 'Alert body',
      read: false,
      timestamp: Timestamp.now(),
      timestamp_iso: new Date().toISOString(),
    };

    test('ALLOW: kiosk can create librarian→admin notification', async () => {
      const db = kiosk().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('notifications').add(validNotif)
      );
    });

    test('ALLOW: staff can create librarian→admin notification', async () => {
      const db = verifiedStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('notifications').add(validNotif)
      );
    });

    test('DENY: non-staff cannot create librarian→admin notification', async () => {
      const db = nonStaff().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('notifications').add(validNotif)
      );
    });

    test('DENY: unauthenticated cannot create librarian→admin notification', async () => {
      const db = unauth().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('notifications').add(validNotif)
      );
    });

    test('DENY: anonymous cannot create librarian→admin notification (REVISED)', async () => {
      const db = anonymous().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('notifications').add(validNotif)
      );
    });

    test('ALLOW: staff can create admin→librarian notification', async () => {
      const db = verifiedStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('admin_notifications').add(validAdminNotif)
      );
    });

    test('DENY: kiosk cannot create admin→librarian notification', async () => {
      const db = kiosk().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('admin_notifications').add(validAdminNotif)
      );
    });

    test('ALLOW: kiosk can update read status on admin_notifications', async () => {
      let docId;
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const ref = await ctx.firestore()
          .collection('libraries').doc(LIBRARY_ID)
          .collection('admin_notifications').add(validAdminNotif);
        docId = ref.id;
      });

      const db = kiosk().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('admin_notifications').doc(docId).update({ read: true })
      );
    });

    test('DENY: kiosk cannot update other fields on notifications', async () => {
      let docId;
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const ref = await ctx.firestore()
          .collection('libraries').doc(LIBRARY_ID)
          .collection('notifications').add(validNotif);
        docId = ref.id;
      });

      const db = kiosk().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('notifications').doc(docId).update({ subject: 'Hacked' })
      );
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     7. Authorized Students — Staff management
  ═══════════════════════════════════════════════════════════════════ */

  describe('/authorized_students permissions', () => {
    const studentEmail = 'student@gmail.com';
    const validStudent = {
      email: studentEmail,
      name: 'Test Student',
      group: 'Regular',
      added_by: 'admin',
      added_at: Timestamp.now(),
    };

    test('ALLOW: read by authenticated user', async () => {
      const db = nonStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('authorized_students').doc(studentEmail).get()
      );
    });

    test('DENY: read by unauthenticated', async () => {
      const db = unauth().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('authorized_students').doc(studentEmail).get()
      );
    });

    test('ALLOW: verified staff can create', async () => {
      const db = verifiedStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('authorized_students').doc(studentEmail).set(validStudent)
      );
    });

    test('DENY: kiosk cannot create', async () => {
      const db = kiosk().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('authorized_students').doc(studentEmail).set(validStudent)
      );
    });

    test('DENY: non-staff cannot create', async () => {
      const db = nonStaff().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('authorized_students').doc(studentEmail).set(validStudent)
      );
    });

    test('DENY: invalid group', async () => {
      const db = verifiedStaff().firestore();
      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('authorized_students').doc(studentEmail).set({
          ...validStudent,
          group: 'InvalidGroup',
        })
      );
    });

    test('ALLOW: verified staff can delete', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore()
          .collection('libraries').doc(LIBRARY_ID)
          .collection('authorized_students').doc(studentEmail).set(validStudent);
      });

      const db = verifiedStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('authorized_students').doc(studentEmail).delete()
      );
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     8. Student Logins — Self-reported profiles
  ═══════════════════════════════════════════════════════════════════ */

  describe('/student_logins permissions', () => {
    const studentEmail = 'student@gmail.com';
    const validLogin = {
      email: studentEmail,
      name: 'Test Student',
      class: '10',
      section: 'A',
      adm_no: 'ADM001',
      first_login_at: Timestamp.now(),
      last_login_at: Timestamp.now(),
    };

    test('ALLOW: user creates own login', async () => {
      const db = auth({
        email: studentEmail,
        email_verified: true,
      }).firestore();

      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('student_logins').doc(studentEmail).set(validLogin)
      );
    });

    test('DENY: user creates login for different email', async () => {
      const db = auth({
        email: studentEmail,
        email_verified: true,
      }).firestore();

      await assertFails(
        db.collection('libraries').doc(LIBRARY_ID).collection('student_logins').doc('other@gmail.com').set({
          ...validLogin,
          email: 'other@gmail.com',
        })
      );
    });

    test('ALLOW: staff can delete', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore()
          .collection('libraries').doc(LIBRARY_ID)
          .collection('student_logins').doc(studentEmail).set(validLogin);
      });

      const db = verifiedStaff().firestore();
      await assertSucceeds(
        db.collection('libraries').doc(LIBRARY_ID).collection('student_logins').doc(studentEmail).delete()
      );
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     9. Kiosk Registry — Server-side only
  ═══════════════════════════════════════════════════════════════════ */

  describe('/kiosk_registry — Admin SDK only', () => {
    test('DENY: read by any client', async () => {
      const db = kiosk().firestore();
      await assertFails(db.collection('kiosk_registry').doc('ws-1').get());
    });

    test('DENY: write by any client', async () => {
      const db = kiosk().firestore();
      await assertFails(db.collection('kiosk_registry').doc('ws-1').set({}));
    });
  });
});

/* ══════════════════════════════════════════════════════════════════
   Test runner entry point
═══════════════════════════════════════════════════════════════════ */

if (require.main === module) {
  console.log('Run with: npx jest test/firestore-rules.spec.js');
  console.log('Ensure Firebase Emulator is running: firebase emulators:start --only firestore');
}
