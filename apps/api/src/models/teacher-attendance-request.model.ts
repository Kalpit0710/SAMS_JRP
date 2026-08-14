import mongoose from "mongoose";

export const ATTENDANCE_REQUEST_TYPES = ["correction", "manual"] as const;
export type AttendanceRequestType = (typeof ATTENDANCE_REQUEST_TYPES)[number];

export const ATTENDANCE_REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export type AttendanceRequestStatus = (typeof ATTENDANCE_REQUEST_STATUSES)[number];

const teacherAttendanceRequestSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    teacherUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    teacherName: { type: String, required: true, trim: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class" },
    className: { type: String, trim: true, default: "" },
    attendanceDate: { type: String, required: true, index: true },
    requestType: { type: String, enum: ATTENDANCE_REQUEST_TYPES, required: true },
    requestedStatus: { type: String, enum: ["on_time", "late", "on_leave"], required: true },
    reason: { type: String, required: true, trim: true },
    existingRecordId: { type: mongoose.Schema.Types.ObjectId, ref: "TeacherAttendanceRecord" },
    status: { type: String, enum: ATTENDANCE_REQUEST_STATUSES, default: "pending", index: true },
    decisionNote: { type: String, trim: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date }
  },
  { timestamps: true }
);

teacherAttendanceRequestSchema.index({ status: 1, createdAt: -1 });
teacherAttendanceRequestSchema.index(
  { teacherId: 1, attendanceDate: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

export const TeacherAttendanceRequestModel = mongoose.model(
  "TeacherAttendanceRequest",
  teacherAttendanceRequestSchema
);
