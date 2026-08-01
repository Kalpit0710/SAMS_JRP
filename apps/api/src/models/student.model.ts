import mongoose from "mongoose";

const studentSchema = new mongoose.Schema(
  {
    regNo: { type: String, required: true, trim: true, unique: true },
    fullName: { type: String, required: true, trim: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class", required: true, index: true },
    rollNumber: { type: String, trim: true },
    dob: { type: Date },
    fatherName: { type: String, trim: true },
    motherName: { type: String, trim: true },
    // Not present in the legacy records - filled in later so absence alerts can be sent.
    phoneNumber: { type: String, trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" }
  },
  { timestamps: true }
);

studentSchema.index({ classId: 1, status: 1 });

export const StudentModel = mongoose.model("Student", studentSchema);
