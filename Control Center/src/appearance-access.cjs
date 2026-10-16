'use strict';

// Keep the access policy aligned with isKioskAdmin in the generated rules.
// Verification and domain membership identify eligible staff; the two grants
// authorize administration of this institution.
async function checkAppearanceAccess(user, config, { getStaff, getGrant }) {
  const deny = message => ({ allowed:false, message });
  if (!user) return deny('Sign in with your institution Google account to publish appearance.');
  const email = typeof user.email === 'string' ? user.email.toLowerCase() : '';
  const domain = config.staffDomain.trim().toLowerCase();
  const project = config.firebase.projectId;
  if (!user.emailVerified) return deny(`The email ${email || 'on this account'} is not verified. Verify the Google account email, then sign in again.`);
  if (!email.endsWith('@' + domain)) return deny(`Signed in as ${email || 'an account without an email'}. Control Center setup allows @${domain}. Use an account in that domain or correct the saved setup domain.`);
  let claims;
  try { claims = await user.getIdTokenResult(); }
  catch (_) { return deny('Could not verify the sign-in session. Check your connection and sign in again.'); }
  if (claims.signInProvider !== 'google.com') return deny('This session was not signed in through Google. Sign out and use Sign in with Google.');
  let staff, grant;
  try { staff = await getStaff(email); }
  catch (_) { return deny(`Could not read staff_accounts/${email} in Firebase project ${project}. Check your connection and the deployed Firestore rules, then recheck access.`); }
  if (!staff.exists()) return deny(`Staff approval is missing in project ${project}. The project owner must create staff_accounts/${email} with active set to boolean true.`);
  if (staff.data().active !== true) return deny(`staff_accounts/${email} is inactive or has the wrong field type. The project owner must set active to boolean true.`);
  try { grant = await getGrant(user.uid); }
  catch (_) { return deny(`Could not read kiosk_admins/${user.uid} in Firebase project ${project}. Check your connection and the deployed Firestore rules, then recheck access.`); }
  if (!grant.exists()) return deny(`Administrator approval is missing in project ${project}. The project owner must create kiosk_admins/${user.uid} with enabled set to boolean true and libraryId set to the string "main".`);
  if (grant.data().enabled !== true) return deny(`kiosk_admins/${user.uid} is disabled or has the wrong field type. The project owner must set enabled to boolean true.`);
  if (grant.data().libraryId !== 'main') return deny(`kiosk_admins/${user.uid} must have libraryId set to the string "main" for this library.`);
  return { allowed:true, message:`Administrator access confirmed for ${email} in project ${project}.` };
}

module.exports = { checkAppearanceAccess };
