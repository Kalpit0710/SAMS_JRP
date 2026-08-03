import { z } from "zod";

export const CreateClassSchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean().optional()
});

export const CreateTeacherSchema = z.object({
  userId: z.string().optional(),
  fullName: z.string().min(1),
  classId: z.string().optional(),
  phoneNumber: z.string().optional(),
  isActive: z.boolean().optional()
});

export const ResetPinSchema = z.object({
  newPin: z.string().min(4).max(64).regex(/^\d+$/, "PIN must contain digits only")
});

export const CreateStudentSchema = z.object({
  regNo: z.string().min(1),
  fullName: z.string().min(1),
  classId: z.string().min(1),
  rollNumber: z.string().optional(),
  dob: z.string().optional(),
  fatherName: z.string().optional(),
  motherName: z.string().optional(),
  phoneNumber: z.string().optional(),
  status: z.enum(["active", "inactive"]).optional()
});

/** Sentinel used by the "Never auto-lock" policy option (365 days). */
export const NEVER_LOCK_MINUTES = 365 * 24 * 60;

export const UpdateLockSchema = z.object({
  attendanceLockMinutes: z.number().int().min(0).max(NEVER_LOCK_MINUTES)
});
