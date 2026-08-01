import mongoose from "mongoose";

const importLogSchema = new mongoose.Schema(
  {
    entity: { type: String, required: true, trim: true, index: true },
    fileName: { type: String, trim: true },
    totalRows: { type: Number, default: 0 },
    createdCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    rowErrors: [
      {
        row: { type: Number, required: true },
        message: { type: String, required: true }
      }
    ],
    rolledBack: { type: Boolean, default: false },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedByName: { type: String, trim: true }
  },
  { timestamps: true }
);

importLogSchema.index({ createdAt: -1 });

export const ImportLogModel = mongoose.model("ImportLog", importLogSchema);
