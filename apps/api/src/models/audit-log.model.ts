import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    username: { type: String, trim: true },
    role: { type: String, trim: true },
    action: { type: String, required: true, trim: true },
    resource: { type: String, required: true, trim: true },
    method: { type: String, required: true, trim: true },
    path: { type: String, required: true, trim: true },
    statusCode: { type: Number, required: true },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, resource: 1, createdAt: -1 });

export const AuditLogModel = mongoose.model("AuditLog", auditLogSchema);
