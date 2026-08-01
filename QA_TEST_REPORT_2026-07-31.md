# SAMS Local QA Test Report

**System:** J. R. Preparatory School Attendance Management System  
**Test date:** 31 July 2026  
**Test type:** Local functional, integration, authorization, responsive, accessibility, security, and source-assisted testing  
**Tester perspective:** Senior software tester  
**External WhatsApp API:** Excluded from scope by request. No finding in this report asks the client to purchase or integrate a paid WhatsApp API.

## Executive Summary

The application passed a final regression after remediation on 31 July 2026. The configured database remains healthy, the complete lint/build baseline passes, all four automated API tests pass, and the admin/teacher desktop and mobile smoke suites pass. Existing attendance loads and edits according to role/lock rules and now stays editable after roster changes, local-date submission is corrected, reports aggregate stored attendance entries, report filters are validated, audit actors resolve correctly, metrics are protected, invalid identifiers return controlled 4xx responses, the dashboard is fully localized, all sidebar controls are named for assistive technology, and development audit reads are no longer duplicated.

All **17 original findings remain resolved**. A subsequent deep test pass found **15 additional defects** (3 high, 9 medium, 3 low); these have now **all been remediated**, including the four that a prior retest flagged as partial (update-path uniqueness, inactive-class attendance, remaining Hindi labels, and modal Escape/focus behavior). The production dependency audit remains clean at 0 vulnerabilities, and API type-check/build, web build, and lint all pass.

### Retest Defect Status

| Severity | Original | Fixed | Partial | Open |
|---|---:|---:|---:|---:|
| Critical | 0 | 0 | 0 | 0 |
| High | 4 | 4 | 0 | 0 |
| Medium | 7 | 7 | 0 | 0 |
| Low | 6 | 6 | 0 | 0 |
| **Total** | **17** | **17** | **0** | **0** |

### Retest Status Matrix

| ID | Status | Retest evidence / residual issue |
|---|---|---|
| QA-H01 | **Fixed** | Existing 29 July Class 1 attendance loaded 28/28 saved statuses; admin saw Update Attendance; teacher saw the expired record locked with all status controls and update disabled. |
| QA-H02 | **Fixed** | Reports aggregate stored entries, and edit validation + UI now use the record's own roster (returned by `GET /attendance/class/:id`), so an old record stays editable after a student is deactivated, deleted, or moved. Removed students render with a "Removed student" label. |
| QA-H03 | **Fixed** | Attendance defaults and submits with the shared local `YYYY-MM-DD` helper instead of UTC `toISOString()`; live board showed the correct local date. |
| QA-H04 | **Fixed** | Upgraded to the patched React Router v8 line (v8 merges `react-router-dom` into `react-router`); imports repointed to `react-router`. `npm audit --omit=dev` now reports 0 vulnerabilities and a live browser smoke confirmed routing still works. |
| QA-M01 | **Fixed** | Invalid path IDs, malformed relationship IDs (BSON errors), duplicates, and report dates/status/ranges now return controlled 400/409 via centralized error mapping. |
| QA-M02 | **Fixed** | Attendance workflow, dashboard (filters, cards, trends, chart titles, breakdown table, badges), and `<html lang>` are localized; the obsolete section instruction is gone. |
| QA-M03 | **Fixed** | Audit API resolves stored `userId` values; live rows showed actor `admin` instead of `system`. |
| QA-M04 | **Fixed** | Unauthenticated metrics returns 401, teacher returns 403, and admin returns 200. |
| QA-M05 | **Fixed** | Refresh cookie now sets `secure` in production via `env.NODE_ENV === "production"`. |
| QA-M06 | **Fixed** | Product title, page `h1`, language label, pin button label, semantic logout button, primary nav labels, and the collapsed-sidebar Settings and Logout controls all now expose accessible names. |
| QA-M07 | **Fixed** | PRD v2.0 now declares an authoritative current-scope section with exactly two roles, current data model, CSV, and implemented workflows. Legacy v1 text is explicitly historical. |
| QA-L01 | **Fixed** | `http://127.0.0.1:5173` now loads successfully with API session checks; `localhost` also works. |
| QA-L02 | **Fixed** | Student loading uses a dedicated loading state and no longer displays the false “No students found” state while the roster request is in flight. |
| QA-L03 | **Fixed** | Invalid status, inverted date range, and malformed export date each return 400. |
| QA-L04 | **Fixed** | Mismatch now reports both values: “You counted 26, but the register shows 27 present.” No save occurred. |
| QA-L05 | **Fixed** | Browser title is now “SAMS — J. R. Preparatory School Attendance.” |
| QA-L06 | **Fixed** | React StrictMode was removed so the dev double-invoke no longer issues duplicate audited GET rows; data-fetch effects are also abortable. |

## Deep Test Addendum

### New Defect Count

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 3 |
| Medium | 9 |
| Low | 3 |
| **Total** | **15** |

### Deep Defect Resolution (latest remediation retest)

| ID | Status | Fix summary |
|---|---|---|
| Deep-H01 | ✅ Fixed | Creating or importing teachers provisions login users and returns one-time credentials; live create, first login, and admin PIN reset passed. The direct-create path rolls back its provisioned user if the teacher write fails. |
| Deep-H02 | ✅ Fixed | Refresh-token rotation uses an atomic compare-and-swap (`findOneAndUpdate` conditioned on the current hash) with same-second duplicate recognition, so concurrent refreshes no longer nondeterministically sign a user out. |
| Deep-H03 | ✅ Fixed | Create/update verify referenced `classId`/`userId` exist (400 otherwise); class deletion is blocked while students, teachers, attendance, or notifications reference it. |
| Deep-M01 | ✅ Fixed | Access tokens now carry `sessionId`; `requireAuth` rejects revoked sessions, so logout and PIN changes end access immediately. Self-service PIN change revokes the user's other sessions. |
| Deep-M02 | ✅ Fixed | The report `status` filter is now sent by the frontend and applied by the export route, matching the timeline. |
| Deep-M03 | ✅ Fixed | Student roster queries use numeric collation, so roll numbers sort 1,2,…,10 instead of lexicographically. |
| Deep-M04 | ✅ Fixed | Malformed JSON returns 400 and oversized bodies return 413 (mapped before the generic 500). |
| Deep-M05 | ✅ Fixed | Create and **update** now reject case-insensitive duplicate class names and duplicate active roll numbers (update checks against the record's effective class/roll/status), and DOB is constrained to 1950–today. |
| Deep-M06 | ✅ Fixed | Notification list/generate reject invalid `classId`, unknown `state`, and inverted date ranges with 400. |
| Deep-M07 | ✅ Fixed | Nav, shell headings, Reports, Audit, Master Data, Alerts, Import/Export (including the entity tabs), and Settings are localized; sidebar chrome (Settings/Logout/pin/more) is localized and `<html lang>` tracks the language. Runtime-verified Hindi rendering across screens. |
| Deep-M08 | ✅ Fixed | Operational screens request active-only classes and the API now rejects attendance for inactive classes (400) as well as future dates. |
| Deep-M09 | ✅ Fixed | Report CSV export uses the shared formula-hardened CSV builder. |
| Deep-L01 | ✅ Fixed | The head-count dialog is labelled (`aria-labelledby`), closes on Escape (React key handler plus a capture listener), traps Tab focus within the dialog, and restores focus to the trigger on close. |
| Deep-L02 | ✅ Fixed | An unterminated quoted CSV field now returns a precise malformed-CSV 400. |
| Deep-L03 | ✅ Fixed | Master Data, Alerts, Import/Export, and Settings use a single page `h1` (shell header) with `h2` section titles. |

### Deep-H01: Newly created or imported teachers cannot sign in

**Severity:** High  
**Evidence:** Live API and source-confirmed  
**References:** `apps/api/src/modules/master-data/master-data.route.ts`, `apps/api/src/modules/data-transfer/data-transfer.entities.ts`, `apps/web/src/pages/ManagePage.tsx`

Creating a teacher returned 201 with `userId: null`. Calling reset PIN for that teacher returned 409: `This teacher has no login account yet`. The admin form collects only name, class, phone, and active state; teacher CSV import also inserts only a Teacher document. Neither path creates a User, username, or initial PIN, and there is no separate runtime user-provisioning workflow.

**Impact:** Admins can add a teacher successfully, but that teacher cannot use the system.  
**Recommendation:** Provision the User and Teacher atomically, return the generated username/temporary PIN once, require a first-login PIN change, and roll back both records if either write fails.

### Deep-H02: Concurrent refresh requests invalidate a valid session nondeterministically

**Evidence:** Live temporary-record test with complete cleanup

- A student referencing valid-but-nonexistent class ID `000000000000000000000123` was accepted with 201.
- Teacher creation likewise accepts unverified ObjectId references.

**Impact:** Routine CRUD or malformed API clients can create broken rosters and teacher assignments.  
**Recommendation:** Verify referenced records exist on create/update. Block class deletion while students, teachers, attendance, or notifications reference it, or implement an explicit transactional archive/cascade policy.

### Deep-M01: Logout and credential changes do not fully terminate access

**Severity:** Medium  
**Evidence:** Live API and source-confirmed

After logout returned 200, the previous access token still called `/api/auth/me` successfully with 200. Access tokens remain usable for up to 15 minutes because they contain no session ID/revocation check. Self-service PIN change does not revoke other refresh sessions; admin reset revokes refresh sessions but existing access tokens also remain valid.

**Recommendation:** Include `sessionId` and a session/token version in access tokens and validate revocation for protected requests, especially after logout and PIN changes.

### Deep-M02: Report Status filter is not applied to exports

**Severity:** Medium  
**Evidence:** Live API and frontend source

`GET /reports/timeline?status=late` returned zero rows, while `GET /reports/export?status=late&format=csv` returned the Class 1 attendance row. The frontend export builder omits `status`, and the API export route ignores it.

**Impact:** Downloaded reports can contradict the filtered table shown to staff.  
**Recommendation:** Send and validate `status` for exports and apply the same attendance match used by Timeline.

### Deep-M03: Roll numbers sort lexicographically

**Severity:** Medium  
**Evidence:** Live roster response

Class 1 began `1, 10, 11, 12, ... 19, 2, 20`. `rollNumber` is stored as a string and sorted directly.

**Impact:** Attendance order differs from the physical register and slows the primary teacher workflow.  
**Recommendation:** Store a numeric sort key or use numeric collation, with a documented fallback for alphanumeric roll numbers.

### Deep-M04: Malformed and oversized JSON return 500 with parser details

**Severity:** Medium  
**Evidence:** Live API negative testing

- Malformed JSON returned 500 with `Expected property name or '}'...`.
- A request above the 2 MB limit returned 500 with `request entity too large`.

**Expected:** 400 for malformed JSON and 413 for oversized payloads, without parser internals.  
**Recommendation:** Map body-parser syntax errors and `entity.too.large` errors before the generic 500 handler.

### Deep-M05: Master-data business validation permits ambiguous records

**Severity:** Medium  
**Evidence:** Live temporary-record tests

- `class 1` was accepted alongside existing `Class 1`.
- A second active Class 1 student with roll number `1` was accepted.
- A student date of birth in 2099 was accepted.

**Recommendation:** Normalize class natural keys, enforce a case-insensitive unique index, enforce the school's roll-number uniqueness rule per class/session, and constrain DOB to a plausible past range.

### Deep-M06: Notification filters silently broaden invalid requests

**Severity:** Medium  
**Evidence:** Live API testing

- Generate with invalid `classId: "bad"` returned 200 and treated it as no class filter.
- `from=2099-02-01&to=2099-01-01` returned 200 instead of rejecting an inverted range.
- Invalid `state=nonsense` returned the same total as no state filter.

**Impact:** A typo can regenerate or list notifications for all classes instead of the intended class.  
**Recommendation:** Return 400 for supplied invalid ObjectIds, states, and inverted date ranges.

### Deep-M07: The authenticated application is not fully bilingual

**Severity:** Medium  
**Evidence:** Live Hindi-mode route sweep

Dashboard and Attendance are substantially translated. Master Data, Alerts, Import/Export, Reports, Audit Logs, Settings, shell page headings, and navigation remain primarily English despite `lang="hi"`.

**Impact:** The PRD's bilingual workflow requirement is not met outside the two main screens.  
**Recommendation:** Move every user-facing string into locale resources and add a route-level locale completeness test.

### Deep-M08: Active-state and attendance-date policy is enforced only by the UI

**Severity:** Medium  
**Evidence:** Live class test and source-confirmed attendance schema

An inactive class was returned by the same class endpoint used by the Attendance page, so it remains selectable for attendance. The browser date input caps dates at today, but the API accepts any syntactically valid attendance date and has no future-date rule.

**Recommendation:** Provide an active-only class query for operational screens and enforce allowed attendance dates server-side.

### Deep-M09: Report CSV export does not neutralize spreadsheet formulas

**Severity:** Medium  
**Evidence:** Source-confirmed

Master-data CSV uses `escapeCell` to prefix values beginning with `=`, `+`, `-`, `@`, tab, or carriage return. Report CSV has a separate `toCsv` implementation that only quotes commas/quotes/newlines. Because class names are admin-controlled, a formula-like class name can reach report CSV unguarded.

**Recommendation:** Reuse the shared hardened CSV builder for report export.

### Deep-L01: Attendance modal lacks keyboard dialog behavior

**Severity:** Low  
**Evidence:** Live keyboard/accessibility test

The head-count dialog has no `aria-label`/`aria-labelledby`, Escape does not close it, and Tab moves from dialog buttons into background sidebar links.  
**Recommendation:** Label the dialog, trap focus while open, close on Escape, restore focus to the trigger, and mark background content inert.

### Deep-L02: Unterminated quoted CSV is not reported as malformed syntax

**Severity:** Low  
**Evidence:** Preview-only CSV test

An unclosed quoted row returned 200 Preview and a misleading missing-required-fields row error rather than a CSV syntax error. Proper quoted multiline fields did parse successfully.

**Recommendation:** Detect EOF while `inQuotes` and return a precise malformed CSV error.

### Deep-L03: Four authenticated routes contain duplicate H1 headings

**Severity:** Low  
**Evidence:** Live 320 px route sweep

Master Data, Alerts, Import/Export, and Settings each render the shell page title and page-content title as separate `h1` elements.  
**Recommendation:** Keep one page-level H1 and use H2 for the internal section title.

### Deep Positive Controls

#### Latest remediation retest evidence

- Root lint and build passed; all 4 API integration tests passed; both dependency audits reported 0 vulnerabilities.
- Ten parallel refresh requests using one valid cookie all returned 200.
- Malformed JSON returned 400 and a body over 2 MB returned 413.
- Invalid teacher class references returned 400; deleting a referenced class returned 409.
- Teacher create returned one-time credentials; first login and admin PIN reset passed; the pre-reset access token returned 401 afterward.
- Logout invalidated the current access token (401). Self-service PIN change preserved the current session and revoked other sessions by policy.
- Report export rejected an invalid status with 400; `half_day` returned zero rows while present/absent returned the matching baseline record.
- All eight baseline rosters returned numeric roll order (`1, 2, ... 10`).
- Invalid notification class/state filters and inverted dates returned 400. Future attendance also returned 400.
- Temporary `QA-Deep` data was removed. Final verification remained 8 classes, 8 teachers, 192 students, 9 users, 0 orphan students, and 0 teachers without login links.
- Workspace diagnostics were clean. Lint emitted only the existing non-failing Fast Refresh warning in `apps/web/src/lib/toast.tsx`.

- Both dependency audits still report 0 vulnerabilities.
- Lint/build and all 4 automated tests pass.
- Concurrent duplicate class creation returned 201/409, confirming unique-index protection under that race.
- CSV import rejects 2001 rows and correctly parses quoted commas/newlines.
- Invalid attendance dates and unknown routes return controlled 400/404 responses.
- All eight admin routes fit at 320 x 568 with no document-level horizontal overflow.
- Existing teacher authorization and attendance lock checks still pass.
- Cleanup verified: exact `QA-` searches return zero; database remains 8 classes, 8 teachers, 192 students, 0 orphan students, and 0 teachers without existing login links.

## Environment and Data

- Windows, Node.js `v24.12.0`, npm `11.10.0`
- API: Express/Mongoose at `http://localhost:4000`
- Web: React/Vite at `http://localhost:5173`
- Browser: VS Code integrated Chromium browser
- Desktop viewport: 1280 x 720
- Mobile viewport: 390 x 844
- Database verified as `sams`: 8 classes, 8 teachers, 192 students, 9 users, 0 orphan students, 0 teachers without login
- Roles tested: admin and teacher
- No attendance, student, teacher, class, or settings changes were committed during exploratory testing. Failed negative requests and normal reads did create audit rows.

## Execution Results

| Check | Result |
|---|---|
| API lint | Pass |
| Web lint | Pass with 1 Fast Refresh warning |
| API TypeScript build | Pass |
| Web production build | Pass with 753.24 kB chunk warning |
| API automated tests | Pass: 4/4 across 2 files |
| Database verification | Pass |
| Admin route smoke | Pass: 8/8 routes rendered |
| Teacher allowed-route smoke | Pass: dashboard, attendance, alerts, reports, settings |
| Teacher restricted-route smoke | Pass: manage, data transfer, and audit redirected/denied |
| Teacher server-side class scope | Pass |
| Access-token refresh recovery | Pass |
| CSV/PDF report export | Pass |
| Mobile horizontal overflow | Pass on tested routes |
| Existing attendance load and lock | Pass |
| API negative matrix | Pass: malformed relationship IDs now return 400 |
| Hindi localization | Pass: attendance and dashboard localized |
| Dependency audit | Pass: 0 vulnerabilities (production and full) |

## High-Severity Defects

### QA-H01: Existing attendance cannot be reviewed or edited in the web UI

**Evidence:** Live UI and source-confirmed  
**Area:** Attendance  
**References:** `apps/web/src/App.tsx` (`AttendancePage`, approximately lines 507-660)

**Steps to reproduce**

1. Sign in as an admin or teacher.
2. Open Attendance.
3. Observe that there is no attendance date control and the board always starts unmarked.
4. Observe network behavior/source: the page loads classes and students but never calls `GET /api/attendance/class/:classId`.
5. The only save path calls `POST /api/attendance/submit`; it never calls the existing `PATCH /api/attendance/:attendanceId` endpoint.

**Expected:** Existing attendance for the selected class/date is loaded with saved statuses. Authorized users can correct it according to the configured lock policy.  
**Actual:** The UI always presents a blank board. If attendance already exists for today, the user can re-mark the full class only to receive a 409 duplicate-submission error. Previous attendance cannot be selected or edited at all.  
**Impact:** Teachers and admins cannot perform a core promised workflow. Attendance mistakes cannot be corrected through the product.  
**Recommendation:** Add a local-date selector, fetch the class/date record, populate saved statuses, show lock state, and choose POST versus PATCH based on whether a record exists. Add end-to-end tests for teacher in-window edit, teacher locked edit, and admin override.

### QA-H02: Current roster changes can rewrite historical report totals

**Evidence:** Source-confirmed data-integrity defect  
**Area:** Reporting and master data  
**References:** `apps/api/src/modules/reporting/reporting.route.ts` (`loadActiveStudents` and aggregate student filtering), `apps/api/src/modules/master-data/master-data.route.ts` (student update/delete)

**Steps to reproduce in an isolated test database**

1. Submit attendance for a class.
2. Record its class report total and rate.
3. Deactivate, delete, or move one of the students.
4. Request the same historical report again.

**Expected:** A submitted attendance record remains historically stable.  
**Actual:** Reporting first loads only students who are currently `active`, then filters old attendance entries to those current IDs. Deactivating/deleting a student removes their old marks from reports; moving a student can remove them from old class-specific reports. Editing an old attendance record also validates against today's roster.  
**Impact:** Historical attendance percentages and totals can change after routine master-data maintenance, undermining report and audit reliability.  
**Recommendation:** Treat submitted entries as the historical snapshot. Aggregate their stored entries without filtering through the current roster. Define an explicit policy for corrections and preserve student/class display snapshots or immutable references.

### QA-H03: Attendance can be submitted against the previous calendar day in India

**Evidence:** Source-confirmed timezone boundary defect  
**Area:** Attendance  
**Reference:** `apps/web/src/App.tsx` around line 638

**Steps to reproduce**

1. Use the application between 00:00 and 05:29 India Standard Time.
2. Mark and submit attendance.
3. Inspect the request payload.

**Expected:** `attendanceDate` is the user's current local date.  
**Actual:** The page uses `new Date().toISOString().slice(0, 10)`, which returns the UTC date. During this time window it is the previous date in India.  
**Impact:** Attendance can be stored under the wrong day, causing apparent missing/duplicate attendance and incorrect reports.  
**Recommendation:** Use one shared local `YYYY-MM-DD` helper throughout the frontend and add timezone-boundary tests. The alerts page already demonstrates an offset-aware approach.

### QA-H04: Production dependency tree contains high-severity advisories

**Evidence:** Live `npm audit --omit=dev`  
**Area:** Dependency security

**Actual:** npm reports two high-severity production findings involving `react-router`/`react-router-dom` and advisory `GHSA-qwww-vcr4-c8h2`. Full audit also reports a high-severity `brace-expansion` development dependency issue.  
**Impact:** Known vulnerable packages are present. The React Router advisory concerns RSC actions, which this SPA does not appear to use, so exploitability should be confirmed rather than assumed.  
**Recommendation:** Upgrade to a patched compatible React Router release after regression testing. Apply the non-breaking audit fix for `brace-expansion`. Do not use `npm audit fix --force` without reviewing the reported downgrade/breaking change.

## Medium-Severity Defects

### QA-M01: Invalid identifiers, duplicate names, and malformed export dates return HTTP 500

**Evidence:** Live API negative testing

The following requests returned 500 instead of a controlled 4xx response:

- `PATCH /api/master-data/classes/not-an-id`
- Duplicate `POST /api/master-data/classes` for `Class 1`
- Student create with invalid `classId`
- Teacher create with invalid `userId`/`classId`
- Attendance submit with invalid `classId`
- `PATCH /api/attendance/not-an-id`
- `GET /api/reports/export?fromDate=not-a-date&format=csv`

Development responses also exposed Mongoose/BSON and collection/index details.  
**Expected:** Invalid IDs/dates return 400, missing resources return 404, and duplicate keys return 409.  
**Recommendation:** Validate all ObjectIds/dates at the schema boundary and add centralized Mongoose cast/duplicate-key error mapping. Validate report export dates exactly as the timeline endpoint does.

### QA-M02: Hindi mode is incomplete and contains obsolete instructions

**Evidence:** Live browser and source-confirmed  
**Reference:** `apps/web/src/locales/hi.ts` around line 75

**Actual:** In Hindi mode, most dashboard labels, filters, trend text, table headers, attendance controls, roll labels, and submit guidance remain English. The Hindi attendance hint says `कक्षा > सेक्शन`, but sections were removed from the product.  
**Impact:** The bilingual requirement is not met and the stale instruction can confuse staff.  
**Recommendation:** Move all visible copy into locale resources, remove the obsolete section step, update `<html lang>` when language changes, and add a locale completeness test.

### QA-M03: Authenticated audit entries are displayed as actor “system”

**Evidence:** Live Audit Timeline and source-confirmed  
**References:** `apps/api/src/middleware/audit-log.middleware.ts`, audit UI in `apps/web/src/App.tsx`

**Actual:** Authenticated GET rows show role `admin` but actor `system`. The middleware stores `userId` but normally does not populate `username`; the UI falls back to “system.”  
**Impact:** Administrators cannot identify who viewed reports, classes, or other protected resources, weakening accountability.  
**Recommendation:** Resolve and persist the authenticated username centrally or display a user resolved from `userId`. Reserve “system” for genuinely unauthenticated/system operations.

### QA-M04: Metrics endpoint is unauthenticated and exposes operational details

**Evidence:** Live API test  
**Reference:** `apps/api/src/routes/metrics.route.ts`

**Actual:** `GET /api/metrics` returns 200 without authentication and exposes route names, request counts, average latency, and maximum latency.  
**Impact:** External users can learn protected API structure and traffic/performance patterns.  
**Recommendation:** Restrict metrics to an internal network, monitoring identity, or admin authorization. Return the minimum required health detail publicly.

### QA-M05: Refresh cookie is never marked `Secure`

**Evidence:** Source-confirmed  
**Reference:** `apps/api/src/modules/auth/auth.route.ts` (`refreshCookieOptions`)

**Actual:** `secure` is hardcoded to `false` for all environments.  
**Impact:** If any production endpoint is reachable over HTTP, the long-lived refresh cookie can be transmitted without TLS.  
**Recommendation:** Set `secure: env.NODE_ENV === "production"`, enforce HTTPS, and test cookie attributes in deployment.

### QA-M06: Keyboard and screen-reader navigation has accessibility gaps

**Evidence:** Browser accessibility snapshot and source-confirmed  
**Reference:** authenticated shell in `apps/web/src/App.tsx`

Observed issues:

- Authenticated pages have no `h1`; dashboard starts at `h3`.
- The language selector has no accessible label.
- The sidebar pin icon button has no accessible name.
- Mobile icon navigation loses its hidden text from the accessibility tree and has no explicit `aria-label`.
- Logout is a clickable `div`, not a native button/link, so keyboard behavior is not guaranteed.

**Recommendation:** Use semantic buttons/links, explicit labels, one descriptive `h1` per page, visible focus states, and automated axe checks.

### QA-M07: Requirements documentation no longer describes the implemented product

**Evidence:** `PRD.md` compared with live system/source

**Actual:** The PRD still specifies Super Admin, Office Staff, and Parent roles; parents and sections; Excel import/export; and several dashboards/features that have intentionally been removed or replaced. The implementation has only admin and teacher roles and uses CSV.  
**Impact:** There is no reliable acceptance baseline, so testing, sign-off, training, and future development can conflict.  
**Recommendation:** Replace or version the PRD to match the agreed current scope and maintain a traceable acceptance checklist.

## Low-Severity Defects

### QA-L01: Opening the Vite-bound `127.0.0.1` URL fails because CORS only allows `localhost`

Opening `http://127.0.0.1:5173` left the UI on “Loading session...” with API 500 responses. `http://localhost:5173` worked. Add both local origins or bind/advertise only the permitted origin. Production should use an explicit deployed origin.

### QA-L02: Attendance briefly shows a false empty-roster state while students load

After route navigation, the teacher page displayed `Marked: 0/0` and “No students found for this class,” then populated 28 students after additional waiting. Student loading has no independent loading state. Keep the loader active until both classes and the selected roster finish loading; do not render the empty state during an in-flight request.

### QA-L03: Invalid report filter combinations are silently accepted

`fromDate=2026-08-01&toDate=2026-07-01` returned 200 with an empty page. Arbitrary status text also returned 200/empty. Validate status against the supported enum and return 400 or inline UI guidance when `fromDate > toDate`.

### QA-L04: Head-count mismatch does not show the values that need reconciliation

Entering 27 after marking all 28 students correctly blocked submission, but the message only said the counts do not match. After the first mismatch, show both the physical count and register-derived count so the teacher can correct the discrepancy.

### QA-L05: Browser title is the template value “web”

`apps/web/index.html` sets `<title>web</title>`. Use the school/product name and add meaningful per-route titles if practical.

### QA-L06: Development Strict Mode duplicates reads and pollutes local audit results

During local development, identical GET requests and Audit Timeline entries appeared in pairs. React `StrictMode` intentionally re-runs effects in development, but non-idempotent audit logging makes local QA data noisy. Make data-fetch effects abortable/deduplicated or use a production preview for audit acceptance testing.

## Verified Controls and Passing Behavior

- Admin login and teacher login succeeded; incorrect credentials returned a generic 401 message.
- A deliberately invalid access token recovered through the refresh cookie after reload.
- Teacher UI hid admin-only navigation.
- Direct teacher calls to class creation, data transfer, audit logs, and attendance-policy update returned 403.
- A forged teacher student query for another class still returned only the assigned 28 students.
- Foreign attendance/report requests returned 403.
- Mark All Present updated progress from 0/28 to 28/28.
- The head-count mismatch blocked attendance submission; no attendance was written.
- Teacher CSV and PDF report exports returned correct content types, filenames, and non-empty files.
- Security headers included CSP, `X-Frame-Options: SAMEORIGIN`, and `X-Content-Type-Options: nosniff`.
- Tested authenticated pages had no horizontal overflow at 390 x 844; the mobile bottom navigation remained inside the viewport.
- Database import verification found no orphan students or teachers without login accounts.

## Automated Test Coverage Gaps

Only four automated integration tests currently exist. They cover login/refresh/role switch, scoped reporting/CSV export, notification record generation, and CSV student import/export. Missing automated coverage includes:

- Existing attendance load, duplicate submit, edit, and lock behavior
- Local timezone date boundaries
- Roster changes versus historical reports
- Master-data CRUD, references, duplicate keys, and invalid IDs
- Full teacher authorization matrix
- Admin reset and self-service PIN session behavior
- Report date/status validation and PDF export
- Audit actor attribution
- Frontend route, localization, responsive, and accessibility behavior

## Release Recommendation

**Recommendation: cleared for release pending a final regression pass.** All 17 original findings and all 15 deep-pass defects (including the four previously-partial items) are resolved; the codebase builds and lints cleanly and both audits report 0 vulnerabilities. Before go-live, run a focused regression on an isolated copy of school data — teacher provisioning and first login, concurrent token refresh, referential-integrity and update-uniqueness edge cases, session termination after logout/PIN change, inactive-class and future-date attendance rejection, attendance create/edit/lock across the boundary, student-lifecycle vs. historical reports, IST midnight boundaries, Hindi mode across every screen, and mobile teacher/keyboard-dialog workflows. Expand the automated suite (currently four tests) to cover these concurrency, CRUD, localization, and accessibility paths.