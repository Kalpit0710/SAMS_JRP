import { Router } from "express";
import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { setAuditMeta } from "../../middleware/audit-log.middleware.js";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware.js";
import { ClassModel } from "../../models/class.model.js";
import { LeaveRequestModel, type LeaveStatus } from "../../models/leave-request.model.js";
import { SubstituteAssignmentModel } from "../../models/substitute-assignment.model.js";
import { getLeaveSettings, LeaveSettingsModel } from "../../models/leave-settings.model.js";
import { TeacherModel } from "../../models/teacher.model.js";
import { buildWhatsAppLink, normalizePhoneNumber } from "../notifications/notification.service.js";
import { formatDateKey, getWorkingDateKeys, todayDateKey } from "./leave-calendar.js";
import {
  AssignSubstituteSchema,
  CreateLeaveRequestSchema,
  LeaveAnalyticsQuerySchema,
  LeaveDecisionSchema,
  LeaveListQuerySchema,
  LeaveRevokeSchema,
  UpdateLeaveSettingsSchema
} from "./leave.schema.js";
import { buildAdminLeaveRequestMessage, buildTeacherLeaveDecisionMessage } from "./leave.templates.js";

export const leaveRouter = Router();
leaveRouter.use(requireAuth);

type LeaveRecord = {
  _id: mongoose.Types.ObjectId;
  teacherId: mongoose.Types.ObjectId;
  teacherUserId: mongoose.Types.ObjectId;
  teacherName: string;
  classId?: mongoose.Types.ObjectId;
  className: string;
  fromDate: string;
  toDate: string;
  reason: string;
  requestedWorkingDates: string[];
  status: LeaveStatus;
  approvedFromDate?: string;
  approvedToDate?: string;
  approvedWorkingDates: string[];
  activeDates: string[];
  decisionNote?: string;
  decidedAt?: Date;
  withdrawnAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

function portalUrl(leaveId: mongoose.Types.ObjectId | string) {
  return `${env.PUBLIC_APP_URL.replace(/\/$/, "")}/leaves?request=${leaveId}`;
}

function validWhatsAppNumber(phoneNumber: string) {
  const normalized = normalizePhoneNumber(phoneNumber);
  return normalized.length >= 10 && normalized.length <= 15 ? normalized : "";
}

function buildLeaveWhatsAppLink(phoneNumber: string, message: string) {
  const normalized = validWhatsAppNumber(phoneNumber);
  return normalized
    ? buildWhatsAppLink(normalized, message)
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
}

async function buildLinks(record: LeaveRecord) {
  const settings = await getLeaveSettings();
  const teacher = await TeacherModel.findById(record.teacherId).select("phoneNumber").lean();
  const url = portalUrl(record._id);
  const adminNumber = validWhatsAppNumber(settings.adminWhatsAppNumber);
  const teacherNumber = validWhatsAppNumber(teacher?.phoneNumber ?? "");
  const adminMessage = buildAdminLeaveRequestMessage({
    teacherName: record.teacherName,
    className: record.className,
    fromDate: record.fromDate,
    toDate: record.toDate,
    reason: record.reason,
    workingDays: record.requestedWorkingDates.length,
    portalUrl: url
  });
  const decisionMessage = record.status === "approved" || record.status === "partially_approved" || record.status === "rejected"
    ? buildTeacherLeaveDecisionMessage({
        teacherName: record.teacherName,
        status: record.status,
        fromDate: record.fromDate,
        toDate: record.toDate,
        approvedFromDate: record.approvedFromDate,
        approvedToDate: record.approvedToDate,
        approvedDays: record.approvedWorkingDates.length,
        note: record.decisionNote,
        portalUrl: url
      })
    : "";

  return {
    portalUrl: url,
    hasAdminWhatsAppNumber: Boolean(adminNumber),
    hasTeacherWhatsAppNumber: Boolean(teacherNumber),
    adminWhatsAppLink: buildLeaveWhatsAppLink(adminNumber, adminMessage),
    teacherWhatsAppLink: decisionMessage ? buildLeaveWhatsAppLink(teacherNumber, decisionMessage) : ""
  };
}

async function serializeLeave(record: LeaveRecord) {
  const substitute = await SubstituteAssignmentModel.findOne({
    leaveRequestId: record._id,
    status: "approved"
  }).select("substituteTeacherId substituteTeacherName classId className dates fromDate toDate note").lean();

  return {
    ...record,
    fromDateLabel: formatDateKey(record.fromDate),
    toDateLabel: formatDateKey(record.toDate),
    approvedFromDateLabel: record.approvedFromDate ? formatDateKey(record.approvedFromDate) : undefined,
    approvedToDateLabel: record.approvedToDate ? formatDateKey(record.approvedToDate) : undefined,
    requestedWorkingDays: record.requestedWorkingDates.length,
    approvedWorkingDays: record.approvedWorkingDates.length,
    substitute: substitute
      ? {
          ...substitute,
          fromDateLabel: formatDateKey(substitute.fromDate),
          toDateLabel: formatDateKey(substitute.toDate)
        }
      : null,
    ...(await buildLinks(record))
  };
}

function asRecord(value: unknown): LeaveRecord {
  return value as LeaveRecord;
}

leaveRouter.get(
  "/settings",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const settings = await getLeaveSettings();
    if (req.auth?.activeRole === "teacher") {
      return res.status(200).json({
        nonWorkingWeekdays: settings.nonWorkingWeekdays,
        holidays: settings.holidays,
        hasAdminWhatsAppNumber: Boolean(validWhatsAppNumber(settings.adminWhatsAppNumber))
      });
    }
    return res.status(200).json(settings);
  })
);

leaveRouter.put(
  "/settings",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = UpdateLeaveSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid leave settings payload", errors: parsed.error.flatten() });
    }
    if (parsed.data.adminWhatsAppNumber && !validWhatsAppNumber(parsed.data.adminWhatsAppNumber)) {
      return res.status(400).json({ message: "Admin WhatsApp number must contain 10 to 15 digits" });
    }

    const settings = await LeaveSettingsModel.findOneAndUpdate(
      {},
      { $set: parsed.data },
      { upsert: true, returnDocument: "after" }
    );
    setAuditMeta(res, {
      action: "LEAVE_SETTINGS_UPDATE",
      resource: "leave/settings",
      metadata: {
        nonWorkingWeekdays: settings.nonWorkingWeekdays,
        holidayCount: settings.holidays.length,
        hasAdminWhatsAppNumber: Boolean(settings.adminWhatsAppNumber)
      }
    });
    return res.status(200).json({
      adminWhatsAppNumber: settings.adminWhatsAppNumber,
      nonWorkingWeekdays: settings.nonWorkingWeekdays,
      holidays: settings.holidays
    });
  })
);

leaveRouter.get(
  "/analytics",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = LeaveAnalyticsQuerySchema.safeParse(req.query);
    if (!parsed.success || parsed.data.fromDate > parsed.data.toDate) {
      return res.status(400).json({ message: "Invalid analytics query", errors: parsed.success ? undefined : parsed.error.flatten() });
    }
    const { fromDate, toDate, teacherId, granularity } = parsed.data;
    if (teacherId && !mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ message: "Invalid teacher identifier" });
    }

    const filter: Record<string, unknown> = {
      fromDate: { $lte: toDate },
      toDate: { $gte: fromDate }
    };
    if (teacherId) {
      filter.teacherId = new mongoose.Types.ObjectId(teacherId);
    }
    const records = (await LeaveRequestModel.find(filter).lean()).map(asRecord);
    const approvedRecords = records.filter((record) => record.status === "approved" || record.status === "partially_approved");
    const trend = new Map<string, number>();
    const teacherTotals = new Map<string, { teacherId: string; teacherName: string; className: string; approvedDays: number; decidedRequests: number }>();
    const teachersOnLeave = new Set<string>();
    let approvedLeaveDays = 0;

    for (const record of approvedRecords) {
      const approvedDates = record.approvedWorkingDates.filter((date) => date >= fromDate && date <= toDate);
      if (approvedDates.length === 0) {
        continue;
      }
      const teacherKey = String(record.teacherId);
      teachersOnLeave.add(teacherKey);
      approvedLeaveDays += approvedDates.length;
      const total = teacherTotals.get(teacherKey) ?? {
        teacherId: teacherKey,
        teacherName: record.teacherName,
        className: record.className,
        approvedDays: 0,
        decidedRequests: 0
      };
      total.approvedDays += approvedDates.length;
      total.decidedRequests += 1;
      teacherTotals.set(teacherKey, total);
      for (const date of approvedDates) {
        const period = granularity === "month" ? date.slice(0, 7) : date;
        trend.set(period, (trend.get(period) ?? 0) + 1);
      }
    }

    const requestCounts = records.reduce<Record<LeaveStatus, number>>(
      (counts, record) => ({ ...counts, [record.status]: counts[record.status] + 1 }),
      { pending: 0, approved: 0, partially_approved: 0, rejected: 0, withdrawn: 0 }
    );
    return res.status(200).json({
      summary: { approvedLeaveDays, distinctTeachers: teachersOnLeave.size, ...requestCounts },
      trend: [...trend.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([period, leaveDays]) => ({ period, leaveDays })),
      teachers: [...teacherTotals.values()].sort((left, right) => right.approvedDays - left.approvedDays)
    });
  })
);

leaveRouter.post(
  "/",
  requireRoles(["teacher"]),
  asyncHandler(async (req, res) => {
    const parsed = CreateLeaveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid leave application", errors: parsed.error.flatten() });
    }
    if (parsed.data.fromDate < todayDateKey()) {
      return res.status(400).json({ message: "Leave applications cannot start in the past" });
    }

    const teacher = await TeacherModel.findOne({ userId: req.auth!.userId, isActive: true }).lean();
    if (!teacher) {
      return res.status(403).json({ message: "No active teacher profile is linked to this account" });
    }
    const settings = await getLeaveSettings();
    let workingDates: string[];
    try {
      workingDates = getWorkingDateKeys(parsed.data.fromDate, parsed.data.toDate, settings);
    } catch (error) {
      return res.status(400).json({ message: error instanceof Error ? error.message : "Invalid leave date range" });
    }
    if (workingDates.length === 0) {
      return res.status(400).json({ message: "The selected range has no school working days" });
    }
    const overlap = await LeaveRequestModel.exists({
      teacherId: teacher._id,
      status: { $in: ["pending", "approved", "partially_approved"] },
      activeDates: { $in: workingDates }
    });
    if (overlap) {
      return res.status(409).json({ message: "This application overlaps an existing active leave request" });
    }
    const classDoc = teacher.classId ? await ClassModel.findById(teacher.classId).select("name").lean() : null;
    const teacherUserId = new mongoose.Types.ObjectId(req.auth!.userId);
    const created = await LeaveRequestModel.create({
      teacherId: teacher._id,
      teacherUserId,
      teacherName: teacher.fullName,
      classId: teacher.classId,
      className: classDoc?.name ?? "",
      fromDate: parsed.data.fromDate,
      toDate: parsed.data.toDate,
      reason: parsed.data.reason,
      requestedWorkingDates: workingDates,
      activeDates: workingDates
    });
    setAuditMeta(res, {
      action: "LEAVE_REQUEST_CREATE",
      resource: "leave/request",
      metadata: { leaveId: created.id, fromDate: parsed.data.fromDate, toDate: parsed.data.toDate, workingDays: workingDates.length }
    });
    return res.status(201).json({ item: await serializeLeave(asRecord(created.toObject())) });
  })
);

leaveRouter.get(
  "/",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const parsed = LeaveListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid leave list query", errors: parsed.error.flatten() });
    }
    const { page, pageSize, status, teacherId, fromDate, toDate, scope } = parsed.data;
    const filter: Record<string, unknown> = {};
    if (req.auth?.activeRole === "teacher") {
      filter.teacherUserId = new mongoose.Types.ObjectId(req.auth.userId);
    } else if (teacherId) {
      if (!mongoose.Types.ObjectId.isValid(teacherId)) {
        return res.status(400).json({ message: "Invalid teacher identifier" });
      }
      filter.teacherId = new mongoose.Types.ObjectId(teacherId);
    }
    if (status) filter.status = status;
    const conditions: Record<string, unknown>[] = [];
    if (fromDate) conditions.push({ toDate: { $gte: fromDate } });
    if (toDate) conditions.push({ fromDate: { $lte: toDate } });
    if (scope === "upcoming") conditions.push({ toDate: { $gte: todayDateKey() } });
    else if (scope === "past") conditions.push({ toDate: { $lt: todayDateKey() } });
    if (conditions.length > 0) filter.$and = conditions;

    const [rows, total] = await Promise.all([
      LeaveRequestModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
      LeaveRequestModel.countDocuments(filter)
    ]);
    const items = await Promise.all(rows.map((row) => serializeLeave(asRecord(row))));
    return res.status(200).json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  })
);

leaveRouter.get(
  "/:id",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = { _id: String(req.params.id) };
    if (req.auth?.activeRole === "teacher") {
      filter.teacherUserId = new mongoose.Types.ObjectId(req.auth.userId);
    }
    const record = await LeaveRequestModel.findOne(filter).lean();
    if (!record) {
      return res.status(404).json({ message: "Leave application not found" });
    }
    return res.status(200).json({ item: await serializeLeave(asRecord(record)) });
  })
);

leaveRouter.post(
  "/:id/withdraw",
  requireRoles(["teacher"]),
  asyncHandler(async (req, res) => {
    const existing = await LeaveRequestModel.findOne({
      _id: String(req.params.id),
      teacherUserId: req.auth!.userId,
      status: { $in: ["pending", "approved", "partially_approved"] }
    }).lean();
    if (!existing) {
      return res.status(409).json({ message: "Only your own pending or approved application can be cancelled" });
    }
    const record = asRecord(existing);
    if (record.status !== "pending" && record.fromDate <= todayDateKey()) {
      return res.status(409).json({ message: "Only leave that has not started yet can be cancelled" });
    }
    const record2 = await LeaveRequestModel.findOneAndUpdate(
      { _id: record._id, status: record.status },
      { $set: { status: "withdrawn", withdrawnBy: req.auth!.userId, withdrawnAt: new Date(), approvedWorkingDates: [], activeDates: [] } },
      { returnDocument: "after" }
    ).lean();
    if (!record2) {
      return res.status(409).json({ message: "This application was already updated" });
    }
    await SubstituteAssignmentModel.updateMany(
      { leaveRequestId: record._id, status: "approved" },
      { $set: { status: "cancelled", cancelledBy: req.auth!.userId, cancelledAt: new Date() } }
    );
    setAuditMeta(res, { action: "LEAVE_REQUEST_WITHDRAW", resource: "leave/request", metadata: { leaveId: String(req.params.id), previousStatus: record.status } });
    return res.status(200).json({ item: await serializeLeave(asRecord(record2)) });
  })
);

leaveRouter.post(
  "/:id/revoke",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = LeaveRevokeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "A reason is required to reject an approved leave", errors: parsed.error.flatten() });
    }
    const existing = await LeaveRequestModel.findOne({
      _id: String(req.params.id),
      status: { $in: ["approved", "partially_approved"] }
    }).lean();
    if (!existing) {
      return res.status(409).json({ message: "Only an approved or partially approved application can be rejected" });
    }
    if (existing.fromDate <= todayDateKey()) {
      return res.status(409).json({ message: "Leave that has already started or passed cannot be rejected" });
    }
    const updated = await LeaveRequestModel.findOneAndUpdate(
      { _id: String(req.params.id), status: existing.status },
      {
        $set: {
          status: "rejected",
          approvedWorkingDates: [],
          activeDates: [],
          decisionNote: parsed.data.note,
          decidedBy: req.auth!.userId,
          decidedAt: new Date()
        }
      },
      { returnDocument: "after" }
    ).lean();
    if (!updated) {
      return res.status(409).json({ message: "This application was already updated" });
    }
    await SubstituteAssignmentModel.updateMany(
      { leaveRequestId: updated._id, status: "approved" },
      { $set: { status: "cancelled", cancelledBy: req.auth!.userId, cancelledAt: new Date() } }
    );
    setAuditMeta(res, { action: "LEAVE_REQUEST_REVOKE", resource: "leave/request", metadata: { leaveId: String(req.params.id), previousStatus: existing.status } });
    return res.status(200).json({ item: await serializeLeave(asRecord(updated)) });
  })
);

leaveRouter.post(
  "/:id/substitute",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = AssignSubstituteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid substitute payload", errors: parsed.error.flatten() });
    }
    if (!mongoose.Types.ObjectId.isValid(parsed.data.substituteTeacherId)) {
      return res.status(400).json({ message: "Invalid substitute teacher identifier" });
    }
    const leave = await LeaveRequestModel.findOne({
      _id: String(req.params.id),
      status: { $in: ["approved", "partially_approved"] }
    }).lean();
    if (!leave) {
      return res.status(409).json({ message: "A substitute can only cover an approved leave" });
    }
    if (!leave.classId) {
      return res.status(409).json({ message: "This teacher has no class that needs cover" });
    }
    if (leave.activeDates.length === 0) {
      return res.status(409).json({ message: "This leave has no approved working days" });
    }
    if (String(leave.teacherId) === parsed.data.substituteTeacherId) {
      return res.status(400).json({ message: "A teacher cannot cover their own leave" });
    }

    const substitute = await TeacherModel.findOne({ _id: parsed.data.substituteTeacherId, isActive: true }).lean();
    if (!substitute) {
      return res.status(404).json({ message: "Substitute teacher not found" });
    }
    const clash = await LeaveRequestModel.exists({
      teacherId: substitute._id,
      status: { $in: ["approved", "partially_approved"] },
      activeDates: { $in: leave.activeDates }
    });
    if (clash) {
      return res.status(409).json({ message: "The selected substitute is on leave during these dates" });
    }

    const dates = [...leave.activeDates].sort();
    await SubstituteAssignmentModel.updateMany(
      { leaveRequestId: leave._id, status: "approved" },
      { $set: { status: "cancelled", cancelledBy: req.auth!.userId, cancelledAt: new Date() } }
    );
    const created = await SubstituteAssignmentModel.create({
      leaveRequestId: leave._id,
      classId: leave.classId,
      className: leave.className ?? "",
      absentTeacherId: leave.teacherId,
      absentTeacherName: leave.teacherName,
      substituteTeacherId: substitute._id,
      substituteTeacherName: substitute.fullName,
      substituteUserId: substitute.userId,
      dates,
      fromDate: dates[0],
      toDate: dates[dates.length - 1],
      note: parsed.data.note,
      approvedBy: req.auth!.userId
    });

    setAuditMeta(res, {
      action: "LEAVE_SUBSTITUTE_ASSIGN",
      resource: "leave/substitute",
      metadata: { leaveId: String(leave._id), substituteTeacherId: String(substitute._id), days: dates.length }
    });
    const updated = await LeaveRequestModel.findById(leave._id).lean();
    return res.status(201).json({ item: await serializeLeave(asRecord(updated)), substitute: created });
  })
);

leaveRouter.delete(
  "/:id/substitute",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const result = await SubstituteAssignmentModel.updateMany(
      { leaveRequestId: String(req.params.id), status: "approved" },
      { $set: { status: "cancelled", cancelledBy: req.auth!.userId, cancelledAt: new Date() } }
    );
    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "No active substitute cover found for this leave" });
    }
    setAuditMeta(res, {
      action: "LEAVE_SUBSTITUTE_CANCEL",
      resource: "leave/substitute",
      metadata: { leaveId: String(req.params.id) }
    });
    const updated = await LeaveRequestModel.findById(String(req.params.id)).lean();
    return res.status(200).json({ item: updated ? await serializeLeave(asRecord(updated)) : null });
  })
);

leaveRouter.get(
  "/substitutes/me",
  requireRoles(["teacher"]),
  asyncHandler(async (req, res) => {
    const items = await SubstituteAssignmentModel.find({
      substituteUserId: new mongoose.Types.ObjectId(req.auth!.userId),
      status: "approved",
      toDate: { $gte: todayDateKey() }
    }).sort({ fromDate: 1 }).lean();
    return res.status(200).json({ items });
  })
);

leaveRouter.post(
  "/:id/decision",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = LeaveDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid leave decision", errors: parsed.error.flatten() });
    }
    const existing = await LeaveRequestModel.findOne({ _id: String(req.params.id), status: "pending" }).lean();
    if (!existing) {
      return res.status(409).json({ message: "Only a pending application can be decided" });
    }
    const record = asRecord(existing);
    let status: LeaveStatus;
    let approvedFromDate: string | undefined;
    let approvedToDate: string | undefined;
    let approvedWorkingDates: string[] = [];
    if (parsed.data.decision === "approve") {
      status = "approved";
      approvedFromDate = record.fromDate;
      approvedToDate = record.toDate;
      approvedWorkingDates = record.requestedWorkingDates;
    } else if (parsed.data.decision === "partially_approve") {
      const partialFromDate = parsed.data.approvedFromDate;
      const partialToDate = parsed.data.approvedToDate;
      if (
        partialFromDate < record.fromDate ||
        partialToDate > record.toDate ||
        partialFromDate > partialToDate
      ) {
        return res.status(400).json({ message: "Partial approval dates must be within the requested range" });
      }
      approvedWorkingDates = record.requestedWorkingDates.filter(
        (date) => date >= partialFromDate && date <= partialToDate
      );
      if (approvedWorkingDates.length === 0 || approvedWorkingDates.length >= record.requestedWorkingDates.length) {
        return res.status(400).json({ message: "Partial approval must include some, but not all, requested working days" });
      }
      status = "partially_approved";
      approvedFromDate = partialFromDate;
      approvedToDate = partialToDate;
    } else {
      status = "rejected";
    }

    const update: Record<string, unknown> = {
      status,
      approvedWorkingDates,
      activeDates: approvedWorkingDates,
      decidedBy: req.auth!.userId,
      decidedAt: new Date()
    };
    if (approvedFromDate) update.approvedFromDate = approvedFromDate;
    if (approvedToDate) update.approvedToDate = approvedToDate;
    if (parsed.data.note) update.decisionNote = parsed.data.note;
    const updated = await LeaveRequestModel.findOneAndUpdate(
      { _id: record._id, status: "pending" },
      { $set: update },
      { returnDocument: "after" }
    ).lean();
    if (!updated) {
      return res.status(409).json({ message: "This application was already decided" });
    }
    setAuditMeta(res, {
      action: "LEAVE_REQUEST_DECIDE",
      resource: "leave/request",
      metadata: { leaveId: String(record._id), status, approvedWorkingDays: approvedWorkingDates.length }
    });
    return res.status(200).json({ item: await serializeLeave(asRecord(updated)) });
  })
);