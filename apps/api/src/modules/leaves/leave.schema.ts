import { z } from "zod";
import { MAX_LEAVE_RANGE_DAYS, parseDateKey } from "./leave-calendar.js";

const DateKeySchema = z.string().refine((value) => parseDateKey(value) !== null, "Date must be a valid YYYY-MM-DD value");

export const CreateLeaveRequestSchema = z.object({
  fromDate: DateKeySchema,
  toDate: DateKeySchema,
  reason: z.string().trim().min(3).max(1000)
}).superRefine((value, context) => {
  if (value.fromDate > value.toDate) {
    context.addIssue({ code: "custom", path: ["toDate"], message: "To date must be on or after from date" });
  }
});

export const LeaveDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), note: z.string().trim().max(1000).optional() }),
  z.object({
    decision: z.literal("partially_approve"),
    approvedFromDate: DateKeySchema,
    approvedToDate: DateKeySchema,
    note: z.string().trim().max(1000).optional()
  }),
  z.object({ decision: z.literal("reject"), note: z.string().trim().max(1000).optional() })
]);

export const UpdateLeaveSettingsSchema = z.object({
  adminWhatsAppNumber: z.string().trim().max(30),
  nonWorkingWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
  holidays: z.array(z.object({ date: DateKeySchema, name: z.string().trim().min(1).max(100) })).max(MAX_LEAVE_RANGE_DAYS)
}).superRefine((value, context) => {
  if (new Set(value.nonWorkingWeekdays).size !== value.nonWorkingWeekdays.length) {
    context.addIssue({ code: "custom", path: ["nonWorkingWeekdays"], message: "Non-working weekdays must be unique" });
  }
  const holidayDates = value.holidays.map((holiday) => holiday.date);
  if (new Set(holidayDates).size !== holidayDates.length) {
    context.addIssue({ code: "custom", path: ["holidays"], message: "Holiday dates must be unique" });
  }
});

export const LeaveListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["pending", "approved", "partially_approved", "rejected", "withdrawn"]).optional(),
  teacherId: z.string().optional(),
  fromDate: DateKeySchema.optional(),
  toDate: DateKeySchema.optional()
});

export const LeaveAnalyticsQuerySchema = z.object({
  fromDate: DateKeySchema,
  toDate: DateKeySchema,
  teacherId: z.string().optional(),
  granularity: z.enum(["day", "month"]).default("day")
});