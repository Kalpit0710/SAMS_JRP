import mongoose from "mongoose";

export const SUBSTITUTE_ASSIGNMENT_STATUSES = ["approved", "cancelled"] as const;
export type SubstituteAssignmentStatus = (typeof SUBSTITUTE_ASSIGNMENT_STATUSES)[number];

/**
 * Temporary class cover created by an admin when a teacher's leave is approved.
 * Access is granted only for the dates listed here, so it expires on its own.
 */
const substituteAssignmentSchema = new mongoose.Schema(
  {
    leaveRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveRequest", required: true, index: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class", required: true, index: true },
    className: { type: String, trim: true, default: "" },
    absentTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    absentTeacherName: { type: String, required: true, trim: true },
    substituteTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    substituteTeacherName: { type: String, required: true, trim: true },
    substituteUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    dates: { type: [String], required: true },
    fromDate: { type: String, required: true },
    toDate: { type: String, required: true },
    status: { type: String, enum: SUBSTITUTE_ASSIGNMENT_STATUSES, default: "approved", index: true },
    note: { type: String, trim: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    approvedAt: { type: Date, default: Date.now },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelledAt: { type: Date }
  },
  { timestamps: true }
);

substituteAssignmentSchema.index({ substituteUserId: 1, status: 1, dates: 1 });
substituteAssignmentSchema.index({ classId: 1, status: 1, dates: 1 });
substituteAssignmentSchema.index(
  { leaveRequestId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "approved" } }
);

export const SubstituteAssignmentModel = mongoose.model(
  "SubstituteAssignment",
  substituteAssignmentSchema
);
