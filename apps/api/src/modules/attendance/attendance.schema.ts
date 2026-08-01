import { z } from "zod";

export const AttendanceEntrySchema = z.object({
  studentId: z.string().min(1),
  status: z.enum(["present", "absent", "late", "half_day"]),
  note: z.string().optional()
});

export const SubmitAttendanceSchema = z.object({
  classId: z.string().min(1),
  attendanceDate: z.string().date(),
  entries: z.array(AttendanceEntrySchema).min(1)
});

export const EditAttendanceSchema = z.object({
  entries: z.array(AttendanceEntrySchema).min(1)
});
