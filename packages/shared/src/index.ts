export const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "late",
  "half_day"
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ROLES = ["super_admin", "admin", "office_staff", "teacher", "parent"] as const;

export type Role = (typeof ROLES)[number];
