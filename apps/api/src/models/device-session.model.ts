import mongoose from "mongoose";

const deviceSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sessionId: { type: String, required: true, unique: true, index: true },
    refreshTokenHash: { type: String, required: true },
    userAgent: { type: String, default: "unknown" },
    ipAddress: { type: String, default: "unknown" },
    activeRole: {
      type: String,
      enum: ["admin", "teacher"],
      required: true
    },
    isRevoked: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

deviceSessionSchema.index({ userId: 1, lastSeenAt: -1 });
deviceSessionSchema.index({ isRevoked: 1, updatedAt: 1 });

export const DeviceSessionModel = mongoose.model("DeviceSession", deviceSessionSchema);
