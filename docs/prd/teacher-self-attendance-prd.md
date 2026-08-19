# Teacher Self-Attendance PRD

Document status: Draft v2 (implementation-ready)
Owner: Product + Engineering
Target release: TBD
School location context: Puranpur, Uttar Pradesh, India

## 1. Problem Statement

The school needs a reliable teacher self-attendance feature where every teacher logs in at the start of the day and marks their own attendance.

Current pain points:

- No trusted daily teacher check-in signal.
- No consistent punctuality tracking.
- Weak linkage between leave approvals and attendance outcomes.

Expected outcome:

- Accurate, policy-driven teacher attendance that captures server time and location validation.
- Strong admin control over PIN policy, allowed attendance area, and in-time rules.
- Unified insights across teacher attendance, leave management, and admin reporting.

## 2. Scope

In scope:

- Teacher self check-in once per school day.
- Validation gates: authenticated session, PIN confirmation, live location inside allowed boundary, valid check-in window.
- Server-authoritative timestamp and status assignment (`on_time` or `late`).
- Admin configuration for geofence parameter, in-time threshold, mark window, and correction policy.
- Integration with admin portal reporting and leave workflows.

Out of scope for this release:

- Biometric or face recognition.
- Offline check-in and deferred sync.
- Payroll integration.
- Multi-site per teacher (single campus policy for now).

## 3. Business Goals and Success Metrics

Primary goals:

- Increase teacher morning check-in compliance.
- Improve punctuality visibility and enforceability.
- Reduce manual attendance correction work.

KPIs:

- Daily check-in completion rate (target TBD).
- On-time percentage trend over 30 days.
- Missed check-ins excluding approved leave.
- Geofence rejection percentage.
- PIN rejection percentage.
- Admin correction percentage (should trend downward after stabilization).

## 4. Users and Permissions

Teacher capabilities:

- Log in and mark attendance once per day.
- View own attendance timeline and outcomes.
- See reason when mark is rejected.

Admin capabilities:

- Configure attendance policy values.
- View dashboards, exceptions, and teacher-level history.
- Apply corrections with mandatory reason and full audit trail.

Access model:

- `teacher` role can access self endpoints only.
- `admin` role can access settings and correction endpoints.

## 5. Functional Requirements

### 5.1 Teacher Marking Flow

1. Teacher signs in.
2. Teacher opens "Mark My Attendance".
3. App requests location permission and fetches current coordinates.
4. Teacher confirms with PIN.
5. Client submits mark request with PIN and location payload.
6. Server validates all gates in this order:
   - Auth and role check.
   - Leave conflict check (full-day leave blocks mark).
   - Duplicate check (already marked today).
   - Time window check.
   - PIN check.
   - Geofence check.
7. If valid, server writes attendance record with server timestamp.
8. Server returns success response with status (`on_time` or `late`).

### 5.2 Validation Rules

Authentication and authorization:

- Request must come from authenticated teacher session.

Date/time:

- Attendance date is computed from school timezone local date key (Asia/Kolkata, not UTC ISO date slicing).
- `markWindowStart` and `markWindowEnd` define allowed check-in window.
- `inTimeThreshold` defines `on_time` vs `late` status.

PIN:

- PIN must match active teacher credential policy.
- Rate limiting on failed PIN attempts per teacher per day.

Location:

- Distance is calculated from configured geofence center using Haversine formula.
- Default geofence radius is 100 meters for initial setup.
- Mark accepted only when `distanceMeters <= geofenceRadiusMeters + boundaryToleranceMeters`.
- If client provides accuracy metadata and it exceeds configured max accuracy threshold, mark is rejected.

Idempotency:

- Re-submitting after success returns deterministic "already marked" response.

### 5.3 Attendance Status Model

Stored statuses:

- `on_time`
- `late`
- `on_leave`
- `corrected`

Derived status for reports:

- `missed` is computed in reporting for teachers who have no mark and are not on approved full-day leave.

### 5.4 Admin Settings

Configurable fields:

- `geofenceCenterLat`, `geofenceCenterLng`
- `geofenceRadiusMeters`
- `boundaryToleranceMeters`
- `markWindowStart`, `markWindowEnd`
- `inTimeThreshold`
- `maxLocationAccuracyMeters` (optional gate)
- `pinMinLength`, `pinNumericOnly`
- `correctionWindowHours`
- `allowAdminBackdateCorrection` (boolean)

Settings behavior:

- Maintain one active settings document for the school.
- Every settings update writes a configuration audit event.

### 5.5 Admin Corrections

Correction rules:

- Admin can correct records within `correctionWindowHours` by default.
- If `allowAdminBackdateCorrection = true`, admin can correct older dates.
- Correction requires reason text and actor identity.

Correction outcomes:

- Original record snapshot is preserved in audit log.
- Final record status becomes `corrected` with `correctedToStatus` metadata.

## 6. Leave Management Integration

Full-day leave:

- Teacher cannot self-mark for an approved full-day leave date.
- Attendance status for that date is represented as `on_leave`.

Partial-day leave:

- Policy is admin-configured.
- Admin can define whether partial-day leave blocks check-in, restricts by half, or allows normal check-in.

State synchronization:

- Leave approve/reject events should trigger attendance insight refresh for affected dates.

Conflict resolution:

- If attendance exists and leave is approved later for the same date, admin review queue should flag the overlap.

## 7. Admin Portal Integration

Settings page additions:

- New "Teacher Attendance Settings" panel in settings.
- Validation hints for geofence and time fields.

Reporting page additions:

- New "Teacher Attendance" report view.
- Filters: date range, teacher, status, class.
- Exception panel: missed, repeated PIN failures, geofence failures.

Operational tooling:

- Correction modal with reason and preview of policy checks.

## 8. Teacher Portal Integration

Navigation and UX:

- Add "My Attendance" menu item for teachers.
- Show today's state card: not marked, on_time, late, on_leave, or blocked reason.

Interaction details:

- Primary CTA: "Mark My Attendance".
- On success, show exact check-in server time and distance validation result.
- On failure, show localized actionable reason.

Localization:

- Full bilingual strings (English/Hindi) for labels, statuses, errors, tooltips, and audit reason prompts.

## 9. Data Model (Proposed)

### 9.1 teacher_attendance_settings

- `_id`
- `geofenceCenterLat` (number)
- `geofenceCenterLng` (number)
- `geofenceRadiusMeters` (number)
- `boundaryToleranceMeters` (number)
- `markWindowStart` (HH:mm)
- `markWindowEnd` (HH:mm)
- `inTimeThreshold` (HH:mm)
- `maxLocationAccuracyMeters` (number, optional)
- `pinMinLength` (number)
- `pinNumericOnly` (boolean)
- `correctionWindowHours` (number)
- `allowAdminBackdateCorrection` (boolean)
- `updatedBy`, `updatedAt`

Bootstrap defaults:

- `geofenceRadiusMeters = 100`
- `allowAdminBackdateCorrection = true`
- `markWindowStart`, `markWindowEnd`, `inTimeThreshold`: mandatory admin configuration

### 9.2 teacher_attendance_records

- `_id`
- `teacherId`
- `attendanceDate` (local date key, YYYY-MM-DD)
- `checkInAtServer` (Date)
- `submittedLat`, `submittedLng`
- `submittedAccuracyMeters` (optional)
- `distanceMeters`
- `status` (`on_time|late|on_leave|corrected`)
- `source` (`self|admin_correction|system_leave_sync`)
- `correctedToStatus` (optional)
- `correctionReason` (optional)
- `createdBy`, `updatedBy`, `createdAt`, `updatedAt`

### 9.3 teacher_attendance_attempt_logs

- `_id`
- `teacherId`
- `attendanceDate`
- `attemptedAt`
- `submittedLat`, `submittedLng` (optional)
- `submittedAccuracyMeters` (optional)
- `distanceMeters` (optional)
- `result` (`accepted|rejected`)
- `failureCode` (`auth_failed|on_leave|already_marked|outside_window|pin_invalid|location_unavailable|out_of_radius|poor_accuracy|rate_limited`)
- `requestMeta` (device/session identifiers as allowed)

### 9.4 Indexes and Constraints

- Unique: `(teacherId, attendanceDate)` on records.
- Query index: `(attendanceDate, status)` for reports.
- Query index: `(teacherId, attendanceDate)` for self history.
- Attempt-log TTL index (configurable retention, example: 90 days).
- Default attempt-log retention: 90 days.

## 10. API Contract (Proposed)

### 10.1 POST /teacher-attendance/mark

Request body:

- `pin`: string
- `location`:
  - `lat`: number
  - `lng`: number
  - `accuracyMeters`: number (optional)

Success response:

- `attendanceDate`
- `checkInAtServer`
- `status` (`on_time|late`)
- `distanceMeters`

Error response (examples):

- `TEACHER_ATTENDANCE_ALREADY_MARKED`
- `TEACHER_ATTENDANCE_OUTSIDE_WINDOW`
- `TEACHER_ATTENDANCE_PIN_INVALID`
- `TEACHER_ATTENDANCE_OUT_OF_RADIUS`
- `TEACHER_ATTENDANCE_ON_LEAVE`
- `TEACHER_ATTENDANCE_RATE_LIMITED`

### 10.2 GET /teacher-attendance/me

Query:

- `from` (YYYY-MM-DD)
- `to` (YYYY-MM-DD)

Response:

- Paginated list of own records with status and check-in metadata.

### 10.3 GET /teacher-attendance/admin/overview

Query:

- `date` or `from/to`
- `status`
- `teacherId`
- `classId` (optional for scoped insights)

Response:

- Aggregates and teacher-level rows for admin view.

### 10.4 PATCH /teacher-attendance/admin/:recordId/correct

Request body:

- `correctedToStatus`
- `correctionReason`

Response:

- Updated record and audit reference.

### 10.5 Settings APIs

- `GET /teacher-attendance/settings`
- `PATCH /teacher-attendance/settings`

## 11. Non-Functional Requirements

Performance:

- Mark API p95 server processing time under 500 ms excluding network latency.

Reliability:

- Attendance writes must be atomic and idempotent for duplicate submission attempts.

Security:

- Never store raw PIN in logs.
- Mask sensitive values in audit/event streams.
- Enforce role checks at API level regardless of UI restrictions.

Observability:

- Add counters for attempts, accepts, rejects by failureCode.
- Add dashboard for daily success and reject trends.

Compliance and privacy:

- Retain only required location precision and retention duration.
- Document data retention and deletion policy.

## 12. Edge Cases

- Teacher checks in exactly at `inTimeThreshold`: treat as `on_time`.
- Teacher checks in at geofence boundary: allow with tolerance.
- Location permission denied: reject with actionable message and guidance.
- Browser sends stale cached location: use timestamp and freshness check.
- Teacher account inactive: block with explicit error.
- Daylight saving/timezone ambiguity: compute by configured school timezone consistently.

## 13. Rollout Plan

Phase 1: Full delivery scope

- Data models, settings APIs, and mark API.
- Teacher My Attendance page and end-to-end self-marking flow.
- Admin settings, attendance overview report, correction workflow, and exception queue.
- Leave conflict flags and attendance-leave drill-down.
- Partial-day leave policy toggles.
- Anti-abuse checks and alert thresholds.

Release controls:

- Feature flag: `teacherSelfAttendanceEnabled`.
- Pilot with selected teachers/classes before school-wide rollout.

## 14. Test Plan

Unit tests:

- Haversine distance and tolerance logic.
- Status assignment by threshold and window.
- Leave conflict rules.
- Duplicate protection and correction policy.

Integration tests:

- Teacher can mark valid attendance once.
- Duplicate mark rejected with stable error code.
- Out-of-radius, bad PIN, outside-window, on-leave rejection paths.
- Admin correction with audit record creation.
- Settings update audit event.

Access control tests:

- Teacher cannot access admin endpoints.
- Admin cannot submit teacher mark endpoint as teacher action.

Localization tests:

- English/Hindi key coverage for all user-facing strings.

## 15. Acceptance Criteria

1. Teacher can mark once per day only after authentication, valid PIN, valid mark window, and in-parameter live location.
2. Server timestamp and computed distance are stored and returned on success.
3. Admin can configure geofence, thresholds, and correction policy from portal settings.
4. Full-day approved leave maps to `on_leave` and is excluded from missed-check calculations.
5. Admin can review attendance, filter exceptions, and apply audited corrections.
6. All APIs enforce role-based access and emit consistent error codes.

## 16. Delivery Checklist

- Product sign-off on policy values and edge cases.
- Schema and API review completed.
- Security and privacy review completed for location + PIN handling.
- UX and i18n copy finalized.
- Test suite green across unit/integration/access-control scenarios.
- Pilot sign-off and rollout playbook prepared.

## 17. Finalized Policy Decisions

Decisions confirmed for this branch:

1. School timezone: `Asia/Kolkata` (India).
2. Default geofence radius: 100 meters.
3. Mark window: admin-configured.
4. In-time threshold: admin-configured.
5. Partial-day leave policy: admin-configured.
6. Admin backdate correction policy: enabled (Option B), with mandatory reason.
7. Attempt-log retention: default 90 days.
8. Location accuracy gate: enforced.

Still configurable by admin after release:

- Boundary tolerance meters.
- Mark window values.
- In-time threshold value.
- Partial-day rule behavior.
- Correction window hours.
