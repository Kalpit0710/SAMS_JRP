import { z } from "zod";

const TimeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Time must use HH:mm");

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
  correctionWindowHours: z.number().finite().nonnegative(),
  allowAdminBackdateCorrection: z.boolean()
}).superRefine((value, context) => {
  const start = timeToMinutes(value.markWindowStart);
  const end = timeToMinutes(value.markWindowEnd);
  const threshold = timeToMinutes(value.inTimeThreshold);
  if (start === null || end === null || threshold === null || end < start) {
    context.addIssue({ code: "custom", path: ["markWindowEnd"], message: "Mark window is invalid" });
  } else if (threshold < start || threshold > end) {
    context.addIssue({ code: "custom", path: ["inTimeThreshold"], message: "Threshold must be within the mark window" });
  }
});

export const TeacherAttendanceHistorySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30)
});

export const TeacherAttendanceOverviewSchema = TeacherAttendanceHistorySchema.extend({
  status: z.enum(["on_time", "late", "on_leave", "corrected", "missed"]).optional(),
  teacherId: z.string().optional(),
  classId: z.string().optional()
});

export const CorrectTeacherAttendanceSchema = z.object({
  correctedToStatus: z.enum(["on_time", "late", "on_leave"]),
  correctionReason: z.string().trim().min(3).max(1000)
});

export function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}
