import mongoose from "mongoose";
import { Router } from "express";
import { verifyPassword } from "../../models/user.model.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { setAuditMeta } from "../../middleware/audit-log.middleware.js";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware.js";
import { TeacherModel } from "../../models/teacher.model.js";
import { LeaveRequestModel } from "../../models/leave-request.model.js";
import {
  TeacherAttendanceAttemptModel,
  TeacherAttendanceRecordModel,
  type TeacherAttendanceFailureCode,
} from "../../models/teacher-attendance.model.js";
import { getTeacherAttendanceSettings, TeacherAttendanceSettingsModel } from "../../models/teacher-attendance-settings.model.js";
import {
  CorrectTeacherAttendanceSchema,
  MarkTeacherAttendanceSchema,
  TeacherAttendanceHistorySchema,
  TeacherAttendanceOverviewSchema,
  TeacherAttendanceSettingsSchema,
  timeToMinutes
} from "./teacher-attendance.schema.js";

const SCHOOL_TIMEZONE = "Asia/Kolkata";
const MAX_FAILED_PIN_ATTEMPTS = 5;
const FAILURE_MESSAGES: Record<string, string> = {
  already_marked: "Teacher attendance is already marked for today",
  outside_window: "Attendance can only be marked during the configured window",
  pin_invalid: "The teacher PIN is incorrect",
  location_unavailable: "A current location is required to mark attendance",
  out_of_radius: "You are outside the allowed attendance area",
  poor_accuracy: "Location accuracy is not sufficient for attendance",
  rate_limited: "Too many failed PIN attempts today; try again tomorrow",
  on_leave: "Approved full-day leave blocks attendance for today"
};

export const teacherAttendanceRouter = Router();
teacherAttendanceRouter.use(requireAuth);

function schoolDateKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function schoolMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHOOL_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60
    + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadius = 6_371_000;
  const radians = (value: number) => value * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function errorResponse(res: { status: (code: number) => { json: (body: unknown) => unknown } }, code: string) {
  return res.status(code === "already_marked" ? 409 : code === "rate_limited" ? 429 : 400).json({
    code: `TEACHER_ATTENDANCE_${code.toUpperCase()}`,
    message: FAILURE_MESSAGES[code] ?? "Attendance could not be marked"
  });
}

async function getTeacher(userId: string) {
  return TeacherModel.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    isActive: true
  });
}

async function recordAttempt(input: {
  teacherId: mongoose.Types.ObjectId;
  attendanceDate: string;
  result: "accepted" | "rejected";
  failureCode?: TeacherAttendanceFailureCode;
  lat?: number;
  lng?: number;
  accuracyMeters?: number;
  distanceMeters?: number;
  req: { headers: Record<string, string | string[] | undefined> };
}) {
  await TeacherAttendanceAttemptModel.create({
    teacherId: input.teacherId,
    attendanceDate: input.attendanceDate,
    attemptedAt: new Date(),
    result: input.result,
    failureCode: input.failureCode,
    submittedLat: input.lat,
    submittedLng: input.lng,
    submittedAccuracyMeters: input.accuracyMeters,
    distanceMeters: input.distanceMeters,
    requestMeta: { userAgent: input.req.headers["user-agent"] }
  });
}

teacherAttendanceRouter.post(
  "/mark",
  requireRoles(["teacher"]),
  asyncHandler(async (req, res) => {
    const parsed = MarkTeacherAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "TEACHER_ATTENDANCE_LOCATION_UNAVAILABLE", message: FAILURE_MESSAGES.location_unavailable });
    }

    const teacher = await getTeacher(req.auth!.userId);
    if (!teacher) {
      return res.status(403).json({ code: "TEACHER_ATTENDANCE_ACCOUNT_INACTIVE", message: "Teacher account is not active" });
    }

    const settings = await getTeacherAttendanceSettings();
    if (!settings.enabled) {
      return res.status(503).json({ code: "TEACHER_ATTENDANCE_DISABLED", message: "Teacher self-attendance is not enabled" });
    }

    const attendanceDate = schoolDateKey();
    const location = parsed.data.location;
    const baseAttempt = {
      teacherId: teacher._id,
      attendanceDate,
      lat: location.lat,
      lng: location.lng,
      accuracyMeters: location.accuracyMeters,
      req
    };

    const approvedFullDayLeave = await LeaveRequestModel.exists({
      teacherId: teacher._id,
      status: "approved",
      activeDates: attendanceDate
    });
    if (approvedFullDayLeave) {
      await recordAttempt({ ...baseAttempt, result: "rejected", failureCode: "on_leave" });
      return errorResponse(res, "on_leave");
    }

    const existing = await TeacherAttendanceRecordModel.findOne({ teacherId: teacher._id, attendanceDate });
    if (existing) {
      await recordAttempt({ ...baseAttempt, result: "rejected", failureCode: "already_marked" });
      return errorResponse(res, "already_marked");
    }

    const start = timeToMinutes(settings.markWindowStart);
    const end = timeToMinutes(settings.markWindowEnd);
    const nowMinutes = schoolMinutes();
    if (start === null || end === null || nowMinutes < start || nowMinutes > end) {
      await recordAttempt({ ...baseAttempt, result: "rejected", failureCode: "outside_window" });
      return errorResponse(res, "outside_window");
    }

    // PIN verification logic removed

    if (settings.maxLocationAccuracyMeters !== null && settings.maxLocationAccuracyMeters !== undefined
      && (location.accuracyMeters === undefined || location.accuracyMeters > settings.maxLocationAccuracyMeters)) {
      await recordAttempt({ ...baseAttempt, result: "rejected", failureCode: "poor_accuracy" });
      return errorResponse(res, "poor_accuracy");
    }

    const distanceMeters = haversineMeters(
      settings.geofenceCenterLat,
      settings.geofenceCenterLng,
      location.lat,
      location.lng
    );
    if (distanceMeters > settings.geofenceRadiusMeters + settings.boundaryToleranceMeters) {
      await recordAttempt({ ...baseAttempt, result: "rejected", failureCode: "out_of_radius", distanceMeters });
      return errorResponse(res, "out_of_radius");
    }

    const threshold = timeToMinutes(settings.inTimeThreshold);
    const status: "on_time" | "late" = threshold !== null && nowMinutes <= threshold ? "on_time" : "late";
    let record;
    try {
      record = await TeacherAttendanceRecordModel.create({
        teacherId: teacher._id,
        attendanceDate,
        checkInAtServer: new Date(),
        submittedLat: location.lat,
        submittedLng: location.lng,
        submittedAccuracyMeters: location.accuracyMeters,
        distanceMeters,
        status,
        source: "self",
        createdBy: req.auth!.userId,
        updatedBy: req.auth!.userId
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        await recordAttempt({ ...baseAttempt, result: "rejected", failureCode: "already_marked", distanceMeters });
        return errorResponse(res, "already_marked");
      }
      throw error;
    }

    await recordAttempt({ ...baseAttempt, result: "accepted", distanceMeters });
    setAuditMeta(res, {
      action: "TEACHER_ATTENDANCE_MARK",
      resource: "teacher-attendance/record",
      metadata: { recordId: record.id, attendanceDate, status, distanceMeters: Math.round(distanceMeters) }
    });
    return res.status(201).json({ item: record });
  })
);

teacherAttendanceRouter.get(
  "/me",
  requireRoles(["teacher"]),
  asyncHandler(async (req, res) => {
    const parsed = TeacherAttendanceHistorySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid attendance history query" });
    const teacher = await getTeacher(req.auth!.userId);
    if (!teacher) return res.status(403).json({ message: "Teacher account is not active" });
    const filter: Record<string, unknown> = { teacherId: teacher._id };
    if (parsed.data.from || parsed.data.to) {
      filter.attendanceDate = { ...(parsed.data.from ? { $gte: parsed.data.from } : {}), ...(parsed.data.to ? { $lte: parsed.data.to } : {}) };
    }
    const [items, total] = await Promise.all([
      TeacherAttendanceRecordModel.find(filter).sort({ attendanceDate: -1 }).skip((parsed.data.page - 1) * parsed.data.pageSize).limit(parsed.data.pageSize).lean(),
      TeacherAttendanceRecordModel.countDocuments(filter)
    ]);
    return res.json({ items, total, page: parsed.data.page, pageSize: parsed.data.pageSize, totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)) });
  })
);

teacherAttendanceRouter.get(
  "/settings",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (_req, res) => res.json(await getTeacherAttendanceSettings()))
);

teacherAttendanceRouter.patch(
  "/settings",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = TeacherAttendanceSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid teacher attendance settings", errors: parsed.error.flatten() });
    const settings = await TeacherAttendanceSettingsModel.findOneAndUpdate(
      {},
      { $set: { ...parsed.data, updatedBy: req.auth!.userId }, $currentDate: { updatedAt: true } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    setAuditMeta(res, {
      action: "TEACHER_ATTENDANCE_SETTINGS_UPDATE",
      resource: "teacher-attendance/settings",
      metadata: { enabled: settings.enabled, geofenceRadiusMeters: settings.geofenceRadiusMeters, markWindowStart: settings.markWindowStart, markWindowEnd: settings.markWindowEnd }
    });
    return res.json(settings);
  })
);

teacherAttendanceRouter.get(
  "/admin/overview",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = TeacherAttendanceOverviewSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid teacher attendance overview query" });
    const from = parsed.data.from ?? parsed.data.to ?? schoolDateKey();
    const to = parsed.data.to ?? parsed.data.from ?? schoolDateKey();
    const teacherFilter: Record<string, unknown> = { isActive: true };
    if (parsed.data.teacherId && mongoose.Types.ObjectId.isValid(parsed.data.teacherId)) teacherFilter._id = parsed.data.teacherId;
    if (parsed.data.classId && mongoose.Types.ObjectId.isValid(parsed.data.classId)) teacherFilter.classId = parsed.data.classId;
    const teachers = await TeacherModel.find(teacherFilter).select("fullName classId").populate("classId", "name").lean();
    const [records, leaves, failures] = await Promise.all([
      TeacherAttendanceRecordModel.find({ attendanceDate: { $gte: from, $lte: to }, teacherId: { $in: teachers.map((teacher) => teacher._id) } }).lean(),
      LeaveRequestModel.find({ status: { $in: ["approved", "partially_approved"] }, teacherId: { $in: teachers.map((teacher) => teacher._id) }, activeDates: { $in: [from, to] } }).lean(),
      TeacherAttendanceAttemptModel.aggregate([{ $match: { attendanceDate: { $gte: from, $lte: to }, result: "rejected" } }, { $group: { _id: "$failureCode", count: { $sum: 1 } } }])
    ]);
    const recordMap = new Map(records.map((record) => [`${record.teacherId}:${record.attendanceDate}`, record]));
    const leaveMap = new Set(leaves.flatMap((leave) => leave.activeDates.map((date) => `${leave.teacherId}:${date}`)));
    const rows = [];
    for (const teacher of teachers) {
      const populatedClass = teacher.classId && typeof teacher.classId === "object" && "name" in teacher.classId
        ? teacher.classId as unknown as { _id: mongoose.Types.ObjectId; name: string }
        : undefined;
      for (let cursor = new Date(`${from}T00:00:00Z`); cursor <= new Date(`${to}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const date = cursor.toISOString().slice(0, 10);
        const record = recordMap.get(`${teacher._id}:${date}`);
        const leave = leaveMap.has(`${teacher._id}:${date}`);
        const status = record?.status ?? (leave ? "on_leave" : "missed");
        if (!parsed.data.status || parsed.data.status === status) {
          rows.push({ teacherId: teacher._id, teacherName: teacher.fullName, classId: populatedClass?._id ?? teacher.classId, className: populatedClass?.name ?? "", attendanceDate: date, status, record });
        }
      }
    }
    const counts = rows.reduce<Record<string, number>>((result, row) => ({ ...result, [row.status]: (result[row.status] ?? 0) + 1 }), {});
    return res.json({ from, to, summary: counts, rows, failures });
  })
);

teacherAttendanceRouter.patch(
  "/admin/:recordId/correct",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = CorrectTeacherAttendanceSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid correction payload", errors: parsed.error.flatten() });
    const record = await TeacherAttendanceRecordModel.findById(req.params.recordId);
    if (!record) return res.status(404).json({ message: "Teacher attendance record not found" });
    const settings = await getTeacherAttendanceSettings();
    const ageHours = (Date.now() - record.createdAt.getTime()) / 3_600_000;
    if (!settings.allowAdminBackdateCorrection && ageHours > settings.correctionWindowHours) {
      return res.status(409).json({ code: "TEACHER_ATTENDANCE_CORRECTION_WINDOW_EXPIRED", message: "Correction window has expired" });
    }
    const original = record.toObject();
    record.status = "corrected";
    record.correctedToStatus = parsed.data.correctedToStatus;
    record.correctionReason = parsed.data.correctionReason;
    record.source = "admin_correction";
    record.updatedBy = new mongoose.Types.ObjectId(req.auth!.userId);
    await record.save();
    setAuditMeta(res, {
      action: "TEACHER_ATTENDANCE_CORRECT",
      resource: "teacher-attendance/record",
      metadata: { recordId: record.id, original, correctedToStatus: parsed.data.correctedToStatus, correctionReason: parsed.data.correctionReason }
    });
    return res.json({ item: record });
  })
);
