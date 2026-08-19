import { z } from "zod";
import { parseDateKey } from "../leaves/leave-calendar.js";
import { TEACHER_DAY_STATUSES, timeToMinutes } from "./attendance-day.js";

export { timeToMinutes };

const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Time must use HH:mm");
const DateKeySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD")
  .refine((value) => parseDateKey(value) !== null, "Date must be a valid calendar date");
const ObjectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid identifier");
const MAX_ATTENDANCE_RANGE_DAYS = 366;

function validateDateRange(value: { from?: string; to?: string }, context: z.RefinementCtx) {
  if (!value.from || !value.to) return;
  const from = parseDateKey(value.from);
  const to = parseDateKey(value.to);
  if (!from || !to) return;
  if (from > to) {
    context.addIssue({ code: "custom", path: ["to"], message: "End date must be on or after start date" });
    return;
  }
  const rangeDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  if (rangeDays > MAX_ATTENDANCE_RANGE_DAYS) {
    context.addIssue({ code: "custom", path: ["to"], message: `Date range cannot exceed ${MAX_ATTENDANCE_RANGE_DAYS} days` });
  }
}

export const MarkTeacherAttendanceSchema = z.object({
  location: z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    accuracyMeters: z.number().finite().nonnegative().optional(),
    capturedAt: z.string().datetime().optional()
  })
});

export const TeacherAttendanceSettingsSchema = z.object({
  enabled: z.boolean(),
  geofenceCenterLat: z.number().finite().min(-90).max(90),
  geofenceCenterLng: z.number().finite().min(-180).max(180),
  geofenceRadiusMeters: z.number().finite().positive(),
  boundaryToleranceMeters: z.number().finite().nonnegative(),
  markWindowStart: TimeSchema,
  markWindowEnd: TimeSchema,
  inTimeThreshold: TimeSchema,
  maxLocationAccuracyMeters: z.number().finite().positive().nullable(),
  pinMinLength: z.number().int().min(4).max(32),
  pinNumericOnly: z.boolean(),
  timezone: z.string().trim().min(1),
  allowCorrectionToLeave: z.boolean(),
  requireConflictResolution: z.boolean()
}).superRefine((value, context) => {
  const start = timeToMinutes(value.markWindowStart);
  const end = timeToMinutes(value.markWindowEnd);
  const threshold = timeToMinutes(value.inTimeThreshold);
  if (start === null || end === null || threshold === null || end < start) {
    context.addIssue({ code: "custom", path: ["markWindowEnd"], message: "Mark window is invalid" });
  } else if (threshold < start || threshold > end) {
    context.addIssue({ code: "custom", path: ["inTimeThreshold"], message: "Threshold must be within the mark window" });
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value.timezone });
  } catch {
    context.addIssue({ code: "custom", path: ["timezone"], message: "Unknown school timezone" });
  }
});

const TeacherAttendanceHistoryFields = {
  from: DateKeySchema.optional(),
  to: DateKeySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30)
};

export const TeacherAttendanceHistorySchema = z.object(TeacherAttendanceHistoryFields).superRefine(validateDateRange);

export const TeacherAttendanceOverviewSchema = z.object({
  ...TeacherAttendanceHistoryFields,
  status: z.enum(TEACHER_DAY_STATUSES).optional(),
  teacherId: ObjectIdSchema.optional(),
  classId: ObjectIdSchema.optional()
}).superRefine(validateDateRange);

export const TeacherAttendanceReportSchema = z.object({
  from: DateKeySchema,
  to: DateKeySchema,
  teacherId: ObjectIdSchema.optional(),
  classId: ObjectIdSchema.optional()
}).superRefine(validateDateRange);

export const CorrectTeacherAttendanceSchema = z.object({
  correctedToStatus: z.enum(["on_time", "late", "on_leave"]),
  correctionReason: z.string().trim().min(3).max(1000)
});

export const CreateAttendanceRequestSchema = z.object({
  attendanceDate: DateKeySchema,
  requestType: z.enum(["correction", "manual"]),
  requestedStatus: z.enum(["on_time", "late", "on_leave"]),
  reason: z.string().trim().min(3).max(1000)
});

export const AttendanceRequestListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30)
});

export const ReviewAttendanceRequestSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  decisionNote: z.string().trim().max(1000).optional()
});

export const ResolveAttendanceConflictSchema = z.object({
  resolution: z.enum(["keep_attendance", "apply_leave"]),
  note: z.string().trim().min(3).max(1000)
});
