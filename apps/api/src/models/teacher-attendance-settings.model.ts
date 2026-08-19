import mongoose from "mongoose";

const teacherAttendanceSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    geofenceCenterLat: { type: Number, required: true, min: -90, max: 90, default: 28.6139 },
    geofenceCenterLng: { type: Number, required: true, min: -180, max: 180, default: 77.209 },
    geofenceRadiusMeters: { type: Number, required: true, min: 1, default: 200 },
    boundaryToleranceMeters: { type: Number, required: true, min: 0, default: 10 },
    markWindowStart: { type: String, required: true, default: "08:00" },
    // After this time an unmarked working day is treated as a real absence.
    markWindowEnd: { type: String, required: true, default: "17:00" },
    inTimeThreshold: { type: String, required: true, default: "08:30" },
    maxLocationAccuracyMeters: { type: Number, min: 0, default: 100 },
    pinMinLength: { type: Number, required: true, min: 4, default: 4 },
    pinNumericOnly: { type: Boolean, required: true, default: true },
    timezone: { type: String, required: true, default: "Asia/Kolkata", trim: true },
    allowCorrectionToLeave: { type: Boolean, required: true, default: true },
    requireConflictResolution: { type: Boolean, required: true, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export const TeacherAttendanceSettingsModel = mongoose.model(
  "TeacherAttendanceSettings",
  teacherAttendanceSettingsSchema
);

export async function getTeacherAttendanceSettings() {
  return TeacherAttendanceSettingsModel.findOneAndUpdate(
    {},
    { $setOnInsert: {} },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
}
