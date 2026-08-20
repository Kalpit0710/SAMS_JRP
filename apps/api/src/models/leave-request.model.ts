import mongoose from "mongoose";

export const LEAVE_STATUSES = ["pending", "approved", "partially_approved", "rejected", "withdrawn"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

const leaveRequestSchema = new mongoose.Schema(
  {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true, index: true },
    teacherUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    teacherName: { type: String, required: true, trim: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class" },
    className: { type: String, trim: true, default: "" },
    fromDate: { type: String, required: true },
    toDate: { type: String, required: true },
    reason: { type: String, required: true, trim: true },
    requestedWorkingDates: { type: [String], required: true },
    status: { type: String, enum: LEAVE_STATUSES, default: "pending", index: true },
    approvedFromDate: { type: String },
    approvedToDate: { type: String },
    approvedWorkingDates: { type: [String], default: [] },
    activeDates: { type: [String], default: [] },
    decisionNote: { type: String, trim: true },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
    withdrawnBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    withdrawnAt: { type: Date }
  },
  { timestamps: true }
);

leaveRequestSchema.index({ teacherId: 1, createdAt: -1 });
leaveRequestSchema.index({ status: 1, createdAt: -1 });
leaveRequestSchema.index({ approvedWorkingDates: 1, teacherId: 1 });
leaveRequestSchema.index(
  { teacherId: 1, activeDates: 1 },
  { unique: true, partialFilterExpression: { "activeDates.0": { $exists: true } } }
);

export const LeaveRequestModel = mongoose.model("LeaveRequest", leaveRequestSchema);