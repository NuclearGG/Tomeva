# Kiosk setup

1. Generate institution rules and desktop configuration in CC.
2. Publish those rules, enable Google/Anonymous/Email-Password authentication, and deploy the Student Portal including its Admin sign-in helper.
3. Sign in to Admin using a verified Google account in the configured staff domain.
4. Use **Kiosk → Create credential** and give the email/password to its Librarian workstation.
5. Enter the credential in Librarian Settings. The app uses protected storage and checks its active Firestore registry entry.

Revocation blocks protected writes for existing kiosk sessions. Offline circulation remains available. Registry documents do not contain passwords. Legacy custom-token Cloud Functions are not part of this setup.
