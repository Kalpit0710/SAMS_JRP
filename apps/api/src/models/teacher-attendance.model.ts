import mongoose from "mongoose";

export const TEACHER_ATTENDANCE_STATUSES = ["on_time", "late", "on_leave", "corrected"] as const;
export type TeacherAttendanceStatus = (typeof TEACHER_ATTENDANCE_STATUSES)[number];
export const CONFLICT_RESOLUTIONS = ["keep_attendance", "apply_leave"] as const;
export type ConflictResolutionValue = (typeof CONFLICT_RESOLUTIONS)[number];
export const TEACHER_ATTENDANCE_FAILURE_CODES = [
  "auth_failed",
  "on_leave",
  "already_marked",
  "outside_window",
  "pin_invalid",
  "location_unavailable",
  "out_of_radius",
  "poor_accuracy",
  "rate_limited"
] as const;
export type TeacherAttendanceFailureCode = (typeof TEACHER_ATTENDANCE_FAILURE_CODES)[number];

const teacherAttendanceRecordSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    attendanceDate: { type: String, required: true, index: true },
    checkInAtServer: { type: Date },
    submittedLat: { type: Number },
    submittedLng: { type: Number },
    submittedAccuracyMeters: { type: Number },
    distanceMeters: { type: Number },
    status: { type: String, enum: TEACHER_ATTENDANCE_STATUSES, required: true, index: true },
    source: { type: String, enum: ["self", "admin_correction", "system_leave_sync", "manual_application"], required: true },
    correctedToStatus: { type: String, enum: ["on_time", "late", "on_leave"] },
    correctionReason: { type: String, trim: true },
    // Kept so a corrected day still shows what actually happened first.
    originalStatus: { type: String, enum: [...TEACHER_ATTENDANCE_STATUSES, "absent"] },
    conflictResolution: { type: String, enum: CONFLICT_RESOLUTIONS },
    conflictResolutionNote: { type: String, trim: true },
    conflictResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    conflictResolvedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

teacherAttendanceRecordSchema.index({ teacherId: 1, attendanceDate: 1 }, { unique: true });
teacherAttendanceRecordSchema.index({ attendanceDate: 1, status: 1 });

export const TeacherAttendanceRecordModel = mongoose.model(
  "TeacherAttendanceRecord",
  teacherAttendanceRecordSchema
);

const teacherAttendanceAttemptSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    attendanceDate: { type: String, required: true, index: true },
    attemptedAt: { type: Date, required: true },
    submittedLat: { type: Number },
    submittedLng: { type: Number },
    submittedAccuracyMeters: { type: Number },
    distanceMeters: { type: Number },
    result: { type: String, enum: ["accepted", "rejected"], required: true },
    failureCode: {
      type: String,
      enum: TEACHER_ATTENDANCE_FAILURE_CODES
    },
    requestMeta: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
);

teacherAttendanceAttemptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const TeacherAttendanceAttemptModel = mongoose.model(
  "TeacherAttendanceAttempt",
  teacherAttendanceAttemptSchema
);
