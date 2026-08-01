import mongoose from "mongoose";

const attendanceSettingsSchema = new mongoose.Schema(
  {
    attendanceLockMinutes: { type: Number, default: 60, min: 0 }
  },
  { timestamps: true }
);

export const AttendanceSettingsModel = mongoose.model("AttendanceSettings", attendanceSettingsSchema);

export async function getAttendanceLockMinutes(): Promise<number> {
  const settings = await AttendanceSettingsModel.findOne();
  return settings?.attendanceLockMinutes ?? 60;
}
