# Libra — School Library Management System
### Complete Technical Documentation

**Version:** 1.0 · **School:** MEACademy · **Status:** Live in production

---

## 1. Overview

Libra is an offline-first library management system built around three separate interfaces, each serving a different audience:

| Interface | Who uses it | Runs where | Access model |
|---|---|---|---|
| **Librarian App** | The school librarian | Electron desktop app, local machine | No login — physical access to the library computer is the trust boundary |
| **Admin Dashboard** | Principal, Vice Principal, school staff | Any web browser, online | Google Sign-In restricted to `@meacademy.in` |
| **Student Portal** | Students, teachers | Any web browser, online | Google Sign-In + staff approval |

The library's day-to-day operations — issuing books, returning them, tracking fines, managing the catalogue — run entirely on the librarian's local machine with **zero internet dependency**. A lightweight summary syncs to the cloud once an hour so the admin dashboard and student portal always have reasonably current data, without ever exposing the full local database.

### Design philosophy

- **Local-first for operations.** The librarian's desk computer is the source of truth. Internet failure never stops the library from functioning.
- **Cloud for visibility, not authority.** Firebase Firestore is a mirror, not a database of record. It carries summaries and requests — never the full transaction history or complete student records.
- **Verification where it matters.** Anyone can browse; only verified identities can act (submit a request, manage access, change settings).

---

## 2. System Architecture

```
┌─────────────────────────┐
│   LIBRARIAN (Electron)  │  ← Source of truth
│   LokiJS local database │
│   No login required     │
└────────────┬─────────────┘
             │ 60-min sync (write-only snapshot)
             │ + real-time listeners (control flag, requests, notifications)
             ▼
┌─────────────────────────────────────────────┐
│              FIRESTORE (cloud)               │
│  /libraries/main            → sync snapshot  │
│  /libraries/main/meta/control → suspend flag │
│  /libraries/main/notifications               │
│  /libraries/main/admin_notifications         │
│  /libraries/main/book_requests               │
│  /libraries/main/authorized_students         │
│  /libraries/main/student_logins              │
└──────┬───────────────────────────┬───────────┘
       │ read + limited write      │ read (gated) + limited write
       ▼                           ▼
┌──────────────────┐      ┌──────────────────────┐
│  ADMIN DASHBOARD  │      │   STUDENT PORTAL      │
│  (browser)        │      │   (browser)           │
│  Staff-only login  │      │   Verified-only view  │
└──────────────────┘      └──────────────────────┘
```

Each interface is a **self-contained file** with its own Firebase initialization — there is no shared backend server. All coordination happens through Firestore documents and security rules.

---

## 3. Technology Stack

| Layer | Technology |
|---|---|
| Librarian app shell | Electron 35 (`main.js`, `preload.js`) |
| Local database | LokiJS (in-memory + `localStorage` persistence via `env: 'BROWSER'`) |
| Cloud database | Firebase Firestore |
| Authentication | Firebase Auth (Google Sign-In) |
| Frontend | Vanilla HTML / CSS / JavaScript (no framework, no build step) |
| Fonts | Fraunces (display/serif) + DM Sans (body) |
| Activity logging | Node `fs` via Electron IPC — plain text files on disk |

No React, no bundler, no npm build pipeline for the UI — every interface is a single HTML file (or a small set of files) that can be opened directly or hosted as static content.

---

## 4. Project File Structure

```
library-app/
├── index.html              Librarian app — main UI (all pages)
├── admin.html               Admin dashboard — self-contained
├── search.html              Student/Teacher portal — self-contained
├── main.js                  Electron main process (window, IPC, activity log)
├── preload.js               Electron context bridge (safe IPC surface)
├── package.json              Electron build config
├── firestore.rules           Firestore security rules (single source of truth)
├── css/
│   └── style.css            Shared styles for the librarian app
├── js/
│   ├── db.js                 LibraryDB — LokiJS data layer (librarian app)
│   ├── app.js                 UI controller (librarian app)
│   └── firebase-sync.js       Cloud sync + notifications + requests (librarian app)
└── README.md
```

`admin.html` and `search.html` each carry their own embedded `<script type="module">` with a private Firebase Auth + Firestore setup — they don't share code with the librarian app, since they run in a browser, not Electron.

---

## 5. The Librarian Interface

**File:** `index.html` + `js/db.js` + `js/app.js` + `js/firebase-sync.js`
**Runs in:** Electron, fully offline-capable
**Trust model:** No login. The library computer's physical access is the security boundary.

### 5.1 Local database (LokiJS)

Five collections, persisted to `localStorage` and auto-saved every 4 seconds:

| Collection | Purpose | Key fields |
|---|---|---|
| `books` | The catalogue | `access_no` (unique), `document`, `author`, `publisher`, `cost`, `pages`, `status` |
| `students` | Local roster | `adm_no` (unique), `name`, `class`, `section`, `roll_no`, `group` |
| `transactions` | Every issue/return/damage/restore event | `transaction_id`, `borrower_type`, `student_adm_no` \| `teacher_name`/`teacher_email`, `book_access_no`, `issue_date`, `due_date`, `return_date`, `fine`, `status` |
| `finePayments` | Log of collected fines | `payment_id`, `transaction_id`, `amount`, `paid_date` |
| `settings` | Single-document config | `fine_per_day`, `loan_days` |

Book status values: `Available`, `Issued`, `Damaged`, `Under Repair`, `Lost`.
Transaction status values: `Active`, `Returned`, `FinePending`.

### 5.2 Onboarding

The app ships with **zero demo data**. On first launch, if either `books` or `students` is empty, a full-screen setup overlay blocks the dashboard until both are populated — either by importing a JSON file or adding a single record. This was a deliberate choice for the production launch: no placeholder data to accidentally leave in a live system.

**Book import format:**
```json
{ "access_no": "F099/09", "document": "Alice's Adventures in Wonderland",
  "author": "Lewis Carroll", "publisher": "Penguin", "cost": "250", "pages": "373" }
```

**Student import format:**
```json
{ "adm_no": "ADM001", "name": "Aarav Sharma", "class": "10", "section": "A", "roll_no": "23" }
```
Importing **replaces the entire collection** — books/students with active transactions keep their correct status automatically.

### 5.3 Issuing books — students vs. teachers

The Issue page has a **Student / Teacher toggle**. Switching modes changes the form fields, the accent color (blue for students, purple for staff), and the issuing logic:

- **Student loan:** requires an ADM No lookup against the local roster. Due date = today + `loan_days` (from Settings). Overdue accrues a fine at `fine_per_day`.
- **Teacher loan:** requires only a name (email optional). **No due date is ever set.** The book stays "Issued" indefinitely until manually returned, and can never accrue a fine — `calcLateDays()` and `getOverdueTransactions()` both explicitly skip any transaction with a null due date.

### 5.4 Returns, damage, and restoration

- **Return** looks up the active transaction for a book's Access No, calculates any fine if overdue, and returns the book to `Available`.
- **Report Damage** sets a book to `Damaged`, `Under Repair`, or `Lost` (mapped from a severity picker: Minor Damage / Repair Needed / Unusable) and logs a note.
- **Restore** brings a `Damaged`/`Under Repair`/`Lost` book back to `Available`, with an optional repair note. Available directly from the Book Catalogue or the Damage page's own list.

### 5.5 Fines

The Fines page has two tabs:
- **Pending** — active fines awaiting payment, with a "Mark Paid" action per row
- **Collected** — full historical log of every fine ever paid, pulled from the separate `finePayments` collection (not just the current transaction status), so the collection history survives even after a transaction record's status changes

### 5.6 Book Requests (from students)

A dedicated **Book Requests** page lists incoming requests submitted through the student portal, sorted **priority-first** (Literary Club / Editorial Board / Staff), then by newest. Each pending request has:
- **Approve & Issue** — directly issues the book (if available) and marks the request `Issued`
- **Decline** — marks the request `Declined`

### 5.7 Notifications

A two-way messaging channel with the admin dashboard. Three message types — `MESSAGE`, `ALERT`, `WARNING` — each with distinct color coding. The librarian can compose and send to admin, and sees a live, real-time feed of incoming admin messages with an unread badge on the nav item.

### 5.8 Exam-time issuance suspension

The librarian's app listens in real time to a control flag (`meta/control`) that the admin can set. When issuance is suspended:
- A persistent red banner appears across every page
- The Issue button is disabled by default
- An explicit **"Override suspension and issue anyway"** checkbox must be ticked to issue regardless — this preserves librarian judgment for genuine exceptions while making the suspension visible and intentional to bypass

### 5.9 Activity log (on-disk audit trail)

Independent of the LokiJS database, **every issue, return, damage report, restoration, fine payment, and undo** is appended as a line to a plain-text log file on disk:

```
logs/transactions-2026-07.log   (rotates monthly)

[2026-07-04 14:32:05] ISSUE     | Book: Alice's Adventures... [F099/01] | Student: Aarav Sharma (ADM001) | Due: 2026-07-18
[2026-07-04 15:10:22] RETURN    | Book: ... | Fine: ₹8 (4 days late)
[2026-07-05 09:05:00] DAMAGE    | Book: ... | Severity: Minor Damage | Status set to: Damaged
[2026-07-05 09:20:00] ISSUE_STAFF | Book: ... | Teacher: Mrs. Rao | No due date
```

Stored under Electron's `app.getPath('userData')/logs/`, which survives app updates. The Settings page shows the current file's entry count, size, and a live tail of the last 50 lines, plus an **Open Log Folder** button. This log is deliberately separate from the database — it survives even if the database is ever cleared, restored, or corrupted, giving the school a durable, human-readable audit trail.

### 5.10 Cloud sync payload

Every 60 minutes (and once 5 seconds after launch, and immediately on reconnect), the librarian app pushes a **summary only** to `/libraries/main`:

```
stats                — counts: total/available/issued/overdue/fines/collected/students
overdueList          — book, student, days overdue, fine accrued
issuedList           — book, student, issue/due date, overdue flag
finesList            — pending fines detail
damagedList          — damaged/repair/lost books
availableList        — books ready to issue
recentCollections    — last 10 fine payments
```

**Never synced:** full transaction history, complete student roster, admin credentials. This is enforced both by what the code sends and by a Firestore rule that explicitly rejects any write containing forbidden keys.

---

## 6. The Admin Interface

**File:** `admin.html` (fully self-contained, single file)
**Runs in:** Any browser, online-only
**Trust model:** Google Sign-In gated to `@meacademy.in` for the sensitive pages (Student Access, Issuance Control)

### 6.1 Overview dashboard

Animated, skeleton-loading stat cards (total books, available, issued, overdue, pending fines, fine amount, fines collected all-time, damaged/lost, students) plus:
- An animated **donut chart** (SVG, `stroke-dasharray` transitions) showing book status breakdown
- Animated **progress bars** for the same distribution
- Top-5 overdue books and top-5 pending fines previews

All numbers **count up** from 0 on every data refresh using an eased `requestAnimationFrame` loop.

### 6.2 Issued / Available / Overdue / Fines / Damaged

Read-only tables mirroring the librarian's sync payload, each with search/filter. These exist purely for institutional visibility — the admin cannot issue, return, or edit any book or fine from here.

### 6.3 Book Requests (read-only)

Same request list the librarian sees, but **view-only** — the admin can monitor request volume and priority activity without being able to approve or decline. Decision-making stays with the librarian, matching the intended workflow: students request, the librarian decides.

### 6.4 Issuance Control

A staff-only page with a single **Suspend / Resume** toggle and a required reason field. Writing this flag to `meta/control` is what the librarian's app and the student portal both listen for.

### 6.5 Student Access — verification management

This is the identity-management core of the admin dashboard, gated behind a `@meacademy.in` Google sign-in check.

**Pending Verification** — a scrollable, real-time list of everyone who has signed into the student portal but hasn't yet been granted access. Shows **Name, Class, ADM No** (self-reported at their first login — see §8.3) with an inline Group dropdown and one-click **Approve** button per row. Approving writes them straight into `authorized_students`, and they disappear from Pending automatically (computed as `student_logins` minus `authorized_students`, no extra state to manage).

**Authorized Students** — the full staff-approved list (Name, Email, Group, Added By), also scrollable with a sticky header, searchable by name or email.

**Manual add** — staff can also directly authorize a student by typing Name + Email + Group, without waiting for them to sign in first.

### 6.6 Notifications

Mirror of the librarian's notification channel — compose and send to the librarian, see incoming messages in real time with unread tracking.

---

## 7. The Student (and Teacher) Interface

**File:** `search.html` (fully self-contained, single file)
**Runs in:** Any browser, online-only
**Trust model:** Google Sign-In + full verification required to see *any* library data

### 7.1 The verification gate

Nothing is visible until the visitor is both **signed in** and **verified**. The gate has four states:

1. **Checking** — brief loading state while Firebase resolves any existing session
2. **Signed out** — Google Sign-In button only
3. **Complete Your Profile** *(first-time, unverified visitors only)* — asks for Class + Admission Number before proceeding (see §8.3)
4. **Access Pending** — signed in, profile submitted, but not yet approved by staff. No data shown, just a message pointing to the admin office
5. **Verified** — the full library unlocks

Identity resolves in one of two ways:
- **Staff:** email ends in `@meacademy.in` → automatically verified, group = `Staff`, every request is automatically priority
- **Student:** email found in `authorized_students` → verified with whatever group staff assigned

### 7.2 Browsing

Once verified, a hero search bar and filterable book grid/list show live availability, pulled from the same synced snapshot the admin dashboard uses. Search is instant, client-side, across title/author/access number. Filter chips: All / Available / Issued Out.

### 7.3 Book requests

Every book card has a **Request This Book** button opening a modal. The requester's **Group field is locked** — auto-filled from their verified identity, never a free-choice dropdown, closing the priority-forgery hole a self-reported field would create. The Firestore rule independently re-validates this server-side (see §9).

Selecting a Literary Club or Editorial Board account (or being staff) automatically flags the request as **priority (⭐)** for the librarian's queue.

### 7.4 My Requests

A personal history (tracked via `localStorage` request IDs + live Firestore status lookup) showing each submitted request's current status: Pending / Approved / Declined / Issued.

### 7.5 Suspend banner

If the librarian's issuance is currently paused by admin, a banner explains this — students can still submit requests during a suspension; the librarian processes them once issuance resumes.

---

## 8. Data Model Reference

### 8.1 Local (LokiJS, librarian machine only)

See §5.1. Never leaves the local machine except as the aggregated, anonymized-of-detail sync payload described in §5.10.

### 8.2 Firestore — `/libraries/main`

The main sync document. Public read (needed by both admin and student portals), write restricted to payloads matching the exact lightweight shape the librarian app sends.

### 8.3 Firestore — `/libraries/main/student_logins/{email}`

**Self-reported**, written by the student themselves at first sign-in — separate and distinct from `authorized_students`. Fields: `email`, `name` (from Google profile), `class`, `adm_no`, `first_login_at`, `last_login_at`. A student can only write their *own* record (Firestore rule checks `request.auth.token.email == document ID`). This collection exists purely to power the admin's Pending Verification list — it grants no access on its own.

### 8.4 Firestore — `/libraries/main/authorized_students/{email}`

**Staff-approved**, the actual source of truth for who can submit requests and with what priority. Fields: `email`, `name`, `group` (`Regular` / `Literary Club` / `Editorial Board`), `added_by`, `added_at`. Only writable by a signed-in `@meacademy.in` account.

### 8.5 Firestore — `/libraries/main/book_requests/{id}`

Fields: `adm_no`, `student_name`, `class`, `section`, `group`, `priority` (bool), `book_access_no`, `book_title`, `note`, `status` (`Pending`/`Approved`/`Declined`/`Issued`), `requester_email`, `timestamp`. Created only by an authenticated user whose `requester_email` matches their own token, and whose `group`/`priority` match what the server already knows about them (staff domain or `authorized_students` lookup) — the client cannot self-declare priority.

### 8.6 Firestore — `/libraries/main/meta/control`

Fields: `issuance_suspended` (bool), `suspend_reason`, `updated_by`, `updated_at`. Writable only by staff.

### 8.7 Firestore — `/libraries/main/notifications` and `/admin_notifications`

Two one-directional channels (librarian→admin, admin→librarian). Each message: `from`, `to`, `type` (`MESSAGE`/`ALERT`/`WARNING`), `subject`, `body`, `read`, `timestamp`.

---

## 9. Security Model

### 9.1 What's protected and how

| Action | Who can do it | Enforced by |
|---|---|---|
| Write the main sync snapshot | Anyone (shape-validated) | Firestore rule: exact key match, forbidden-key rejection |
| Submit a book request | Signed-in + verified only | Firestore rule: `requester_email` must equal auth token; `group`/`priority` must match server-known identity |
| Approve/decline a request | Anyone with the librarian app | Unauthenticated by design — local kiosk trust model |
| Write `authorized_students` | Signed-in `@meacademy.in` only | Firestore rule: `isStaff()` check on email domain |
| Write `meta/control` (suspend) | Anyone (shape-validated) | *(see note below)* |
| Read any collection | Public, or signed-in depending on collection | Per-collection `allow read` rules |

**Note on scope:** Authentication was deliberately added where forgery does real harm — priority-request submission and student-access management. The librarian's app and the admin dashboard's general viewing/notification features remain on the original open trust model, appropriate for a school-internal tool with no adversarial public exposure. This is a conscious trade-off, not an oversight — documented here so a future maintainer understands the boundary.

### 9.2 Firebase config exposure

The Firebase client config (API key, project ID, etc.) is intentionally public in client-side code — this is normal and expected for Firebase web apps. It is **not a secret**; all real access control lives in `firestore.rules`, which is the actual security boundary and the only file that should be treated as security-critical.

### 9.3 Group/priority forgery prevention

This was the key hardening pass: originally, a student could select their own "Group" from a dropdown when submitting a request — meaning anyone could claim Literary Club or Editorial Board priority. The fix has two layers:
1. **Client:** the Group field is populated from the verified identity and rendered `disabled` — not user-editable
2. **Server (Firestore rule):** independently re-derives the correct group (staff domain check, or `get()` lookup against `authorized_students`) and rejects the write if the submitted `group`/`priority` don't match

Layer 2 is what actually matters — layer 1 is a courtesy that prevents confusion, not the security boundary.

---

## 10. Setup & Deployment

### 10.1 Librarian app (Electron)

```bash
cd library-app
npm install
npm start                 # development
npm run build:win         # Windows installer + portable exe
npm run build:linux       # Linux zip
```

Notes from real deployment experience:
- `better-sqlite3` was removed from dependencies — the app uses LokiJS with `localStorage`, no native compilation needed
- Windows builds must disable code signing (`sign: null`) to avoid symlink-privilege errors with `winCodeSign`
- Close the running app before rebuilding — a locked `app.asar` is the most common build failure

### 10.2 Admin dashboard & Student portal

Both are static single HTML files. Any static host works (Firebase Hosting, GitHub Pages, or even a shared network drive for local testing). **Google Sign-In requires a real HTTP(S) origin** — opening the file directly (`file://`) will not allow the sign-in popup to complete.

### 10.3 Firebase project setup

1. Enable **Firestore** (Native mode)
2. Enable **Authentication → Google** sign-in provider
3. Paste the contents of `firestore.rules` into **Firestore → Rules** and publish
4. No Cloud Functions, no backend server — everything runs client-side against Firestore directly

---

## 11. Known Limitations & Future Work

- The librarian app and general admin dashboard viewing remain unauthenticated by design (see §9.1) — acceptable for the current closed-school context, worth revisiting if the tool's exposure ever changes
- `authorized_students` and the librarian's local student roster are **two separate lists** — a student authorized for the portal isn't automatically added to the librarian's local database and vice versa. Unifying these would need a shared email field on the local roster, not currently present
- No push notifications — the librarian sees new requests/messages only while the app is open and the listener is live
- Firestore reads for the main sync document are open to anyone with the project config, including the librarian and admin apps which don't authenticate — a deliberate trade-off documented in §9.1, not a gap in the student-portal-specific hardening

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Access No** | Unique identifier for a single physical book copy (e.g. `F099/01`) |
| **ADM No** | Student admission number, the local roster's primary key |
| **Sync snapshot** | The lightweight summary document the librarian app pushes to Firestore hourly |
| **Verified** | Signed in AND either staff-domain-matched or admin-authorized |
| **Priority request** | A book request flagged for the librarian's early attention — Literary Club, Editorial Board, or Staff |
| **Teacher loan** | A book issued to staff — no due date, never accrues a fine |

---

*This document reflects the system as built through the full development conversation — from initial mockup through Firebase sync, notifications, book requests, teacher issuance, authentication, and the activity log. Keep it updated as the system evolves.*
