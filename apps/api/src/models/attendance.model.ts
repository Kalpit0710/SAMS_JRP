import mongoose from "mongoose";

const attendanceEntrySchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    status: {
      type: String,
      required: true,
      enum: ["present", "absent", "late", "half_day"]
    },
    note: { type: String, trim: true }
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class", required: true, index: true },
    attendanceDate: { type: Date, required: true, index: true },
    entries: { type: [attendanceEntrySchema], default: [] },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    lockedAt: { type: Date, required: true }
  },
  { timestamps: true }
);

attendanceSchema.index({ classId: 1, attendanceDate: 1 }, { unique: true });

export const AttendanceModel = mongoose.model("Attendance", attendanceSchema);
