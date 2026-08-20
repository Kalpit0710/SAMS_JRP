import mongoose from "mongoose";

const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const leaveSettingsSchema = new mongoose.Schema(
  {
    adminWhatsAppNumber: { type: String, default: "", trim: true },
    nonWorkingWeekdays: {
      type: [Number],
      default: [0],
      validate: {
        validator: (values: number[]) => values.every((value) => Number.isInteger(value) && value >= 0 && value <= 6),
        message: "Non-working weekdays must be between 0 and 6"
      }
    },
    holidays: { type: [holidaySchema], default: [] }
  },
  { timestamps: true }
);

export const LeaveSettingsModel = mongoose.model("LeaveSettings", leaveSettingsSchema);

export type LeaveSettings = {
  adminWhatsAppNumber: string;
  nonWorkingWeekdays: number[];
  holidays: Array<{ date: string; name: string }>;
};

export async function getLeaveSettings(): Promise<LeaveSettings> {
  const settings = await LeaveSettingsModel.findOne().lean();
  return {
    adminWhatsAppNumber: settings?.adminWhatsAppNumber ?? "",
    nonWorkingWeekdays: settings?.nonWorkingWeekdays ?? [0],
    holidays: (settings?.holidays ?? []).map((holiday) => ({ date: holiday.date, name: holiday.name }))
  };
}