import mongoose from "mongoose";

const studentAcademicYearArchiveEntrySchema = new mongoose.Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    presentLikeDays: { type: Number, default: 0 },
    present: { type: Number, default: 0 },
    absent: { type: Number, default: 0 },
    late: { type: Number, default: 0 },
    halfDay: { type: Number, default: 0 },
    totalMarkedDays: { type: Number, default: 0 }
  },
  { _id: false }
);

const studentAcademicYearArchiveSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class", required: true, index: true },
    academicYear: { type: String, required: true, trim: true, index: true },
    academicYearStart: { type: Date, required: true },
    academicYearEnd: { type: Date, required: true },
    totals: {
      presentLikeDays: { type: Number, default: 0 },
      present: { type: Number, default: 0 },
      absent: { type: Number, default: 0 },
      late: { type: Number, default: 0 },
      halfDay: { type: Number, default: 0 },
      totalMarkedDays: { type: Number, default: 0 }
    },
    monthly: { type: [studentAcademicYearArchiveEntrySchema], default: [] },
    finalizedAt: { type: Date, default: Date.now },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

studentAcademicYearArchiveSchema.index({ studentId: 1, academicYear: 1 }, { unique: true });

export const StudentAcademicYearArchiveModel = mongoose.model("StudentAcademicYearArchive", studentAcademicYearArchiveSchema);
