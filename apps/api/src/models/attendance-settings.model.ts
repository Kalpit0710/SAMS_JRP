import mongoose from "mongoose";

const attendanceSettingsSchema = new mongoose.Schema(
  {
    attendanceLockMinutes: { type: Number, default: 60, min: 0 },
    academicYearStartMonth: { type: Number, default: 4, min: 1, max: 12 },
    academicYearStartDay: { type: Number, default: 1, min: 1, max: 31 },
    retentionDays: {
      type: Number,
      default: 2,
      min: 1,
      max: 3650
    }
  },
  { timestamps: true }
);

export const AttendanceSettingsModel = mongoose.model("AttendanceSettings", attendanceSettingsSchema);

export async function getAttendanceLockMinutes(): Promise<number> {
  const settings = await AttendanceSettingsModel.findOne();
  return settings?.attendanceLockMinutes ?? 60;
}

export async function getAttendanceRetentionDays(): Promise<number> {
  const settings = await AttendanceSettingsModel.findOne();
  return settings?.retentionDays ?? 2;
}

export async function getAcademicYearStart(): Promise<{ month: number; day: number }> {
  const settings = await AttendanceSettingsModel.findOne();
  return {
    month: settings?.academicYearStartMonth ?? 4,
    day: settings?.academicYearStartDay ?? 1
  };
}
