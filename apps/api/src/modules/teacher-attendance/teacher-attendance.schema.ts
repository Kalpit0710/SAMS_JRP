import { z } from "zod";
import { TEACHER_DAY_STATUSES, timeToMinutes } from "./attendance-day.js";

export { timeToMinutes };

const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Time must use HH:mm");
const DateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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

export const TeacherAttendanceHistorySchema = z.object({
  from: DateKeySchema.optional(),
  to: DateKeySchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30)
});

export const TeacherAttendanceOverviewSchema = TeacherAttendanceHistorySchema.extend({
  status: z.enum(TEACHER_DAY_STATUSES).optional(),
  teacherId: z.string().optional(),
  classId: z.string().optional()
});

export const TeacherAttendanceReportSchema = z.object({
  from: DateKeySchema,
  to: DateKeySchema,
  teacherId: z.string().optional(),
  classId: z.string().optional()
});

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
