import mongoose from "mongoose";

const classSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const ClassModel = mongoose.model("Class", classSchema);
