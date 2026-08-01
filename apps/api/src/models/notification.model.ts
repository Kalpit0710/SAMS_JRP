import mongoose from "mongoose";

export const NOTIFIABLE_STATUSES = ["absent", "late", "half_day"] as const;

export type NotifiableStatus = (typeof NOTIFIABLE_STATUSES)[number];

const notificationSchema = new mongoose.Schema(
  {
    attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: "Attendance", required: true, index: true },
    attendanceDate: { type: Date, required: true, index: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "Class", required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true, index: true },
    studentName: { type: String, required: true, trim: true },
    parentName: { type: String, trim: true },
    phoneNumber: { type: String, trim: true },
    status: { type: String, enum: NOTIFIABLE_STATUSES, required: true },
    channel: { type: String, enum: ["whatsapp"], default: "whatsapp" },
    messageEn: { type: String, required: true },
    messageHi: { type: String, required: true },
    state: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "pending", index: true },
    failureReason: { type: String, trim: true },
    sentAt: { type: Date },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

// One notification per student per day keeps regeneration idempotent.
notificationSchema.index({ studentId: 1, attendanceDate: 1 }, { unique: true });
notificationSchema.index({ attendanceDate: -1, state: 1 });

export const NotificationModel = mongoose.model("Notification", notificationSchema);
