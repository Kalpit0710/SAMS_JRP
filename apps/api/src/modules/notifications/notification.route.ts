import mongoose from "mongoose";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/async-handler.js";
import { MATCH_NOTHING, resolveTeacherClassId } from "../../lib/teacher-scope.js";
import { setAuditMeta } from "../../middleware/audit-log.middleware.js";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware.js";
import { AttendanceModel } from "../../models/attendance.model.js";
import { ClassModel } from "../../models/class.model.js";
import { NotificationModel } from "../../models/notification.model.js";
import { TeacherModel } from "../../models/teacher.model.js";
import { buildWhatsAppLink, syncNotificationsForAttendance } from "./notification.service.js";
import { buildBilingualMessage } from "./notification.templates.js";

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

const staffRoles = ["admin", "teacher"] as const;
const NOTIFICATION_STATES = ["pending", "sent", "failed", "skipped"] as const;

const UpdateStateSchema = z.object({
  state: z.enum(NOTIFICATION_STATES),
  failureReason: z.string().trim().max(300).optional()
});

const BulkStateSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  state: z.enum(NOTIFICATION_STATES)
});

const GenerateSchema = z.object({
  date: z.string().min(10),
  classId: z.string().optional()
});

function normalizeDate(dateString: string) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function toDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function objectIdOrNull(value: unknown) {
  return typeof value === "string" && mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

type NotificationRow = {
  _id: mongoose.Types.ObjectId;
  classId: mongoose.Types.ObjectId;
  messageEn: string;
  messageHi: string;
  phoneNumber?: string;
};

type AdminNotificationContext = {
  classNames: Map<string, string>;
  teacherNames: Map<string, string>;
};

function decorate(row: NotificationRow, adminContext?: AdminNotificationContext) {
  const classId = row.classId.toString();
  const bilingualMessage = buildBilingualMessage(row.messageEn, row.messageHi);
  return {
    ...row,
    ...(adminContext ? {
      className: adminContext.classNames.get(classId) ?? "-",
      teacherName: adminContext.teacherNames.get(classId) ?? "-"
    } : {}),
    message: bilingualMessage,
    waLink: buildWhatsAppLink(row.phoneNumber ?? "", bilingualMessage),
    waLinkEn: buildWhatsAppLink(row.phoneNumber ?? "", row.messageEn),
    waLinkHi: buildWhatsAppLink(row.phoneNumber ?? "", row.messageHi)
  };
}

notificationRouter.get(
  "/",
  requireRoles([...staffRoles]),
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const rawPage = typeof query.page === "string" ? Number.parseInt(query.page, 10) : Number.NaN;
    const rawPageSize = typeof query.pageSize === "string" ? Number.parseInt(query.pageSize, 10) : Number.NaN;
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const pageSize = Number.isFinite(rawPageSize) ? Math.min(Math.max(rawPageSize, 1), 100) : 20;

    const filter: Record<string, unknown> = {};

    if (typeof query.state === "string" && query.state) {
      if (!(NOTIFICATION_STATES as readonly string[]).includes(query.state)) {
        return res.status(400).json({ message: "Invalid state filter" });
      }
      filter.state = query.state;
    }

    if (typeof query.date === "string" && query.date.trim()) {
      const date = normalizeDate(query.date);
      if (!date) {
        return res.status(400).json({ message: "date must be a valid ISO date" });
      }
      filter.attendanceDate = date;
    } else if (typeof query.from === "string" && typeof query.to === "string") {
      const from = normalizeDate(query.from);
      const to = normalizeDate(query.to);
      if (!from || !to) {
        return res.status(400).json({ message: "from and to must be valid ISO dates" });
      }
      if (from.getTime() > to.getTime()) {
        return res.status(400).json({ message: "from must be on or before to" });
      }
      filter.attendanceDate = { $gte: from, $lte: to };
    }

    if (typeof query.classId === "string" && query.classId && !mongoose.isValidObjectId(query.classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }
    const classId = objectIdOrNull(query.classId);
    if (req.auth?.activeRole === "teacher") {
      filter.classId = (await resolveTeacherClassId(req.auth.userId)) ?? MATCH_NOTHING;
    } else if (classId) {
      filter.classId = classId;
    }

    const [items, total] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ attendanceDate: -1, studentName: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      NotificationModel.countDocuments(filter)
    ]);
    const notificationRows = items as unknown as NotificationRow[];
    let adminContext: AdminNotificationContext | undefined;

    if (req.auth?.activeRole === "admin") {
      const classIds = [...new Set(notificationRows.map((item) => item.classId.toString()))]
        .map((id) => new mongoose.Types.ObjectId(id));
      const [classes, teachers] = await Promise.all([
        ClassModel.find({ _id: { $in: classIds } }).select("name").lean(),
        TeacherModel.find({ classId: { $in: classIds } }).select("classId fullName").lean()
      ]);
      adminContext = {
        classNames: new Map(classes.map((item) => [item._id.toString(), item.name])),
        teacherNames: new Map(teachers.flatMap((item) => item.classId ? [[item.classId.toString(), item.fullName]] : []))
      };
    }

    return res.status(200).json({
      items: notificationRows.map((item) => decorate(item, adminContext)),
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1)
    });
  })
);

notificationRouter.get(
  "/summary",
  requireRoles([...staffRoles]),
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const filter: Record<string, unknown> = {};

    if (typeof query.date === "string" && query.date.trim()) {
      const date = normalizeDate(query.date);
      if (!date) {
        return res.status(400).json({ message: "date must be a valid ISO date" });
      }
      filter.attendanceDate = date;
    }

    if (req.auth?.activeRole === "teacher") {
      filter.classId = (await resolveTeacherClassId(req.auth.userId)) ?? MATCH_NOTHING;
    }

    const grouped = await NotificationModel.aggregate<{ _id: string; count: number }>([
      { $match: filter },
      { $group: { _id: "$state", count: { $sum: 1 } } }
    ]);

    const summary = { pending: 0, sent: 0, failed: 0, skipped: 0, total: 0 };
    for (const bucket of grouped) {
      if (bucket._id in summary) {
        summary[bucket._id as keyof typeof summary] = bucket.count;
      }
      summary.total += bucket.count;
    }

    return res.status(200).json({ summary });
  })
);

notificationRouter.post(
  "/generate",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = GenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    }

    const date = normalizeDate(parsed.data.date);
    if (!date) {
      return res.status(400).json({ message: "date must be a valid ISO date" });
    }

    if (parsed.data.classId && !mongoose.isValidObjectId(parsed.data.classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }
    const filter: Record<string, unknown> = { attendanceDate: date };
    const classId = objectIdOrNull(parsed.data.classId);
    if (classId) {
      filter.classId = classId;
    }

    const records = await AttendanceModel.find(filter).lean();
    let created = 0;
    let updated = 0;

    for (const record of records) {
      const result = await syncNotificationsForAttendance({
        _id: record._id,
        classId: record.classId,
        attendanceDate: record.attendanceDate,
        entries: record.entries
      });
      created += result.created;
      updated += result.updated;
    }

    setAuditMeta(res, {
      action: "NOTIFICATION_GENERATE",
      resource: "notification",
      metadata: { date: toDateKey(date), attendanceRecords: records.length, created, updated }
    });

    return res.status(200).json({ attendanceRecords: records.length, created, updated });
  })
);

notificationRouter.patch(
  "/:id/state",
  requireRoles([...staffRoles]),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    const parsed = UpdateStateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    }

    const isSent = parsed.data.state === "sent";
    const scope: Record<string, unknown> = { _id: id };
    if (req.auth?.activeRole === "teacher") {
      scope.classId = (await resolveTeacherClassId(req.auth.userId)) ?? MATCH_NOTHING;
    }

    const item = await NotificationModel.findOneAndUpdate(
      scope,
      {
        $set: {
          state: parsed.data.state,
          failureReason: parsed.data.state === "failed" ? parsed.data.failureReason ?? "" : "",
          sentAt: isSent ? new Date() : null,
          sentBy: isSent ? req.auth?.userId : null
        }
      },
      { returnDocument: "after" }
    ).lean();

    if (!item) {
      return res.status(404).json({ message: "Notification not found" });
    }

    setAuditMeta(res, {
      action: "NOTIFICATION_STATE_UPDATE",
      resource: "notification",
      metadata: {
        notificationId: id,
        attendanceId: item.attendanceId.toString(),
        attendanceDate: toDateKey(item.attendanceDate),
        classId: item.classId.toString(),
        studentId: item.studentId.toString(),
        studentName: item.studentName,
        state: parsed.data.state
      }
    });

    return res.status(200).json({ item: decorate(item as unknown as NotificationRow) });
  })
);

notificationRouter.post(
  "/bulk-state",
  requireRoles([...staffRoles]),
  asyncHandler(async (req, res) => {
    const parsed = BulkStateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload", issues: parsed.error.issues });
    }

    const ids = parsed.data.ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
    if (ids.length === 0) {
      return res.status(400).json({ message: "No valid notification ids supplied" });
    }

    const isSent = parsed.data.state === "sent";
    const scope: Record<string, unknown> = { _id: { $in: ids } };
    if (req.auth?.activeRole === "teacher") {
      scope.classId = (await resolveTeacherClassId(req.auth.userId)) ?? MATCH_NOTHING;
    }

    const result = await NotificationModel.updateMany(
      scope,
      {
        $set: {
          state: parsed.data.state,
          sentAt: isSent ? new Date() : null,
          sentBy: isSent ? req.auth?.userId : null
        }
      }
    );

    setAuditMeta(res, {
      action: "NOTIFICATION_BULK_STATE_UPDATE",
      resource: "notification",
      metadata: {
        requestedCount: ids.length,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        state: parsed.data.state
      }
    });

    return res.status(200).json({ modified: result.modifiedCount });
  })
);
