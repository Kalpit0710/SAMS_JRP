import mongoose from "mongoose";
import { Router } from "express";
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
import { TeacherAttendanceRequestModel } from "../../models/teacher-attendance-request.model.js";
import { getTeacherAttendanceSettings, TeacherAttendanceSettingsModel } from "../../models/teacher-attendance-settings.model.js";
import {
  AttendanceRequestListQuerySchema,
  CorrectTeacherAttendanceSchema,
  CreateAttendanceRequestSchema,
  MarkTeacherAttendanceSchema,
  ResolveAttendanceConflictSchema,
  ReviewAttendanceRequestSchema,
  TeacherAttendanceHistorySchema,
  TeacherAttendanceOverviewSchema,
  TeacherAttendanceReportSchema,
  TeacherAttendanceSettingsSchema,
  timeToMinutes
} from "./teacher-attendance.schema.js";
import {
  resolveDay,
  schoolDateKey as dayKeyInZone,
  schoolMinutes as minutesInZone
} from "./attendance-day.js";
import { buildDayRows, loadAttendanceContext, summariseRows } from "./attendance-status.service.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
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

function schoolDateKey(timezone: string = DEFAULT_TIMEZONE, now = new Date()): string {
  return dayKeyInZone(timezone, now);
}

function schoolMinutes(timezone: string = DEFAULT_TIMEZONE, now = new Date()): number {
  return minutesInZone(timezone, now);
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

    const attendanceDate = schoolDateKey(settings.timezone);
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
      status: { $in: ["approved", "partially_approved"] },
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
    const nowMinutes = schoolMinutes(settings.timezone);
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
  "/me/days",
  requireRoles(["teacher"]),
  asyncHandler(async (req, res) => {
    const parsed = TeacherAttendanceHistorySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid attendance history query" });
    const teacher = await getTeacher(req.auth!.userId);
    if (!teacher) return res.status(403).json({ message: "Teacher account is not active" });
    const context = await loadAttendanceContext();
    const from = parsed.data.from ?? `${context.today.slice(0, 7)}-01`;
    const to = parsed.data.to ?? context.today;
    const { rows } = await buildDayRows({
      teachers: [{ _id: teacher._id, fullName: teacher.fullName, classId: teacher.classId }],
      from,
      to
    });
    const todayRow = rows.find((row) => row.attendanceDate === context.today) ?? null;
    return res.json({
      from,
      to,
      timezone: context.timezone,
      windowStart: context.settings.markWindowStart,
      finalizesAt: context.settings.markWindowEnd,
      today: todayRow,
      rows,
      summary: summariseRows(rows)
    });
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
      {
        $set: { ...parsed.data, updatedBy: req.auth!.userId },
        // Retired by the "absent at end of day, corrections never expire" policy.
        $unset: { correctionWindowHours: "", allowAdminBackdateCorrection: "" },
        $currentDate: { updatedAt: true }
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, strict: false }
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
    const context = await loadAttendanceContext();
    const from = parsed.data.from ?? parsed.data.to ?? context.today;
    const to = parsed.data.to ?? parsed.data.from ?? context.today;
    const teacherFilter: Record<string, unknown> = { isActive: true };
    if (parsed.data.teacherId && mongoose.Types.ObjectId.isValid(parsed.data.teacherId)) teacherFilter._id = parsed.data.teacherId;
    if (parsed.data.classId && mongoose.Types.ObjectId.isValid(parsed.data.classId)) teacherFilter.classId = parsed.data.classId;
    const teachers = await TeacherModel.find(teacherFilter).select("fullName classId").populate("classId", "name").lean();

    const [{ rows }, failures] = await Promise.all([
      buildDayRows({ teachers, from, to }),
      TeacherAttendanceAttemptModel.aggregate([
        { $match: { attendanceDate: { $gte: from, $lte: to }, result: "rejected" } },
        { $group: { _id: "$failureCode", count: { $sum: 1 } } }
      ])
    ]);

    const visible = parsed.data.status ? rows.filter((row) => row.status === parsed.data.status) : rows;
    return res.json({
      from,
      to,
      timezone: context.timezone,
      finalizesAt: context.settings.markWindowEnd,
      summary: summariseRows(rows),
      rows: visible,
      failures
    });
  })
);

teacherAttendanceRouter.get(
  "/admin/report",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = TeacherAttendanceReportSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid attendance report query", errors: parsed.error.flatten() });
    const teacherFilter: Record<string, unknown> = { isActive: true };
    if (parsed.data.teacherId && mongoose.Types.ObjectId.isValid(parsed.data.teacherId)) teacherFilter._id = parsed.data.teacherId;
    if (parsed.data.classId && mongoose.Types.ObjectId.isValid(parsed.data.classId)) teacherFilter.classId = parsed.data.classId;
    const teachers = await TeacherModel.find(teacherFilter).select("fullName classId").populate("classId", "name").lean();
    const { rows } = await buildDayRows({ teachers, from: parsed.data.from, to: parsed.data.to });

    const byTeacher = new Map<string, {
      teacherId: string; teacherName: string; className: string;
      workingDays: number; present: number; late: number; absent: number; onLeave: number;
      corrected: number; conflicts: number; pendingCorrections: number; notDue: number;
    }>();

    for (const row of rows) {
      if (!byTeacher.has(row.teacherId)) {
        byTeacher.set(row.teacherId, {
          teacherId: row.teacherId, teacherName: row.teacherName, className: row.className,
          workingDays: 0, present: 0, late: 0, absent: 0, onLeave: 0,
          corrected: 0, conflicts: 0, pendingCorrections: 0, notDue: 0
        });
      }
      const entry = byTeacher.get(row.teacherId)!;
      if (!row.isWorkingDay) continue;
      if (row.status === "not_due" || row.status === "pending") { entry.notDue += 1; continue; }
      entry.workingDays += 1;
      if (row.wasCorrected) entry.corrected += 1;
      if (row.hasConflict) entry.conflicts += 1;
      if (row.correctionPending) entry.pendingCorrections += 1;
      if (row.effectiveStatus === "present") entry.present += 1;
      else if (row.effectiveStatus === "late") entry.late += 1;
      else if (row.effectiveStatus === "on_leave") entry.onLeave += 1;
      else if (row.effectiveStatus === "absent") entry.absent += 1;
    }

    const items = [...byTeacher.values()].map((entry) => ({
      ...entry,
      // Non-working days are excluded from the denominator.
      attendanceRate: entry.workingDays === 0
        ? null
        : Math.round(((entry.present + entry.late) / entry.workingDays) * 1000) / 10
    }));
    return res.json({ from: parsed.data.from, to: parsed.data.to, items });
  })
);

teacherAttendanceRouter.get(
  "/admin/alerts",
  requireRoles(["admin"]),
  asyncHandler(async (_req, res) => {
    const context = await loadAttendanceContext();
    const teachers = await TeacherModel.find({ isActive: true }).select("fullName classId").populate("classId", "name").lean();
    const monthStart = `${context.today.slice(0, 7)}-01`;
    const [{ rows: todayRows }, { rows: monthRows }, pendingCorrections] = await Promise.all([
      buildDayRows({ teachers, from: context.today, to: context.today }),
      buildDayRows({ teachers, from: monthStart, to: context.today }),
      TeacherAttendanceRequestModel.countDocuments({ status: "pending" })
    ]);

    const repeatAbsentees = [...monthRows
      .filter((row) => row.effectiveStatus === "absent")
      .reduce((counts, row) => counts.set(row.teacherId, {
        teacherName: row.teacherName,
        count: (counts.get(row.teacherId)?.count ?? 0) + 1
      }), new Map<string, { teacherName: string; count: number }>())]
      .map(([teacherId, value]) => ({ teacherId, ...value }))
      .filter((entry) => entry.count >= 3)
      .sort((a, b) => b.count - a.count);

    return res.json({
      date: context.today,
      finalizesAt: context.settings.markWindowEnd,
      isDayClosed: context.finalizeMinutes !== null && context.nowMinutes >= context.finalizeMinutes,
      pendingAttendance: todayRows.filter((row) => row.status === "pending").length,
      absentToday: todayRows.filter((row) => row.status === "absent").length,
      onLeaveToday: todayRows.filter((row) => row.status === "on_leave").length,
      conflicts: monthRows.filter((row) => row.hasConflict),
      pendingCorrections,
      repeatAbsentees
    });
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
    if (parsed.data.correctedToStatus === "on_leave" && !settings.allowCorrectionToLeave) {
      return res.status(409).json({ code: "TEACHER_ATTENDANCE_LEAVE_CORRECTION_DISABLED", message: "Correcting attendance to leave is disabled" });
    }
    const original = record.toObject();
    if (!record.originalStatus) record.originalStatus = record.status;
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

teacherAttendanceRouter.patch(
  "/admin/:recordId/resolve-conflict",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = ResolveAttendanceConflictSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid conflict resolution payload", errors: parsed.error.flatten() });
    const record = await TeacherAttendanceRecordModel.findById(req.params.recordId);
    if (!record) return res.status(404).json({ message: "Teacher attendance record not found" });
    const onLeave = await LeaveRequestModel.exists({
      teacherId: record.teacherId,
      status: { $in: ["approved", "partially_approved"] },
      activeDates: record.attendanceDate
    });
    if (!onLeave) return res.status(409).json({ message: "This date no longer has an approved leave conflict" });

    record.conflictResolution = parsed.data.resolution;
    record.conflictResolutionNote = parsed.data.note;
    record.conflictResolvedBy = new mongoose.Types.ObjectId(req.auth!.userId);
    record.conflictResolvedAt = new Date();
    record.updatedBy = new mongoose.Types.ObjectId(req.auth!.userId);
    await record.save();
    setAuditMeta(res, {
      action: "TEACHER_ATTENDANCE_CONFLICT_RESOLVE",
      resource: "teacher-attendance/record",
      metadata: { recordId: record.id, attendanceDate: record.attendanceDate, resolution: parsed.data.resolution }
    });
    return res.json({ item: record });
  })
);

// Teacher-initiated correction / manual-attendance requests, subject to admin approval.
teacherAttendanceRouter.post(
  "/requests",
  requireRoles(["teacher"]),
  asyncHandler(async (req, res) => {
    const parsed = CreateAttendanceRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid attendance request", errors: parsed.error.flatten() });
    const teacher = await getTeacher(req.auth!.userId);
    if (!teacher) return res.status(403).json({ message: "Teacher account is not active" });
    const context = await loadAttendanceContext();
    if (parsed.data.attendanceDate > context.today) {
      return res.status(400).json({ message: "Attendance date cannot be in the future" });
    }
    if (parsed.data.requestedStatus === "on_leave" && !context.settings.allowCorrectionToLeave) {
      return res.status(409).json({ code: "TEACHER_ATTENDANCE_LEAVE_CORRECTION_DISABLED", message: "Correcting attendance to leave is disabled" });
    }

    const existingRecord = await TeacherAttendanceRecordModel.findOne({ teacherId: teacher._id, attendanceDate: parsed.data.attendanceDate });
    if (parsed.data.requestType === "correction" && !existingRecord) {
      return res.status(409).json({ message: "No existing attendance record found for this date to correct" });
    }
    if (parsed.data.requestType === "manual" && existingRecord) {
      return res.status(409).json({ message: "Attendance is already marked for this date" });
    }

    const onApprovedLeave = await LeaveRequestModel.exists({
      teacherId: teacher._id,
      status: { $in: ["approved", "partially_approved"] },
      activeDates: parsed.data.attendanceDate
    });
    const day = resolveDay({
      date: parsed.data.attendanceDate,
      today: context.today,
      nowMinutes: context.nowMinutes,
      finalizeMinutes: context.finalizeMinutes,
      calendar: context.calendar,
      record: existingRecord
        ? {
            status: existingRecord.status,
            correctedToStatus: existingRecord.correctedToStatus ?? null,
            conflictResolution: existingRecord.conflictResolution ?? null,
            originalStatus: existingRecord.originalStatus ?? null
          }
        : null,
      onApprovedLeave: Boolean(onApprovedLeave)
    });
    if (!day.isWorkingDay) {
      return res.status(409).json({ code: "TEACHER_ATTENDANCE_NON_WORKING_DAY", message: "This date is not a school working day" });
    }
    if (!day.isFinalized && !existingRecord) {
      return res.status(409).json({ code: "TEACHER_ATTENDANCE_DAY_OPEN", message: "Attendance is still open for this date" });
    }

    await teacher.populate("classId", "name");
    const populatedClass = teacher.classId && typeof teacher.classId === "object" && "name" in teacher.classId
      ? teacher.classId as unknown as { _id: mongoose.Types.ObjectId; name: string }
      : undefined;

    let created;
    try {
      created = await TeacherAttendanceRequestModel.create({
        teacherId: teacher._id,
        teacherUserId: req.auth!.userId,
        teacherName: teacher.fullName,
        classId: populatedClass?._id ?? teacher.classId,
        className: populatedClass?.name ?? "",
        attendanceDate: parsed.data.attendanceDate,
        requestType: parsed.data.requestType,
        requestedStatus: parsed.data.requestedStatus,
        originalStatus: day.status,
        reason: parsed.data.reason,
        existingRecordId: existingRecord?._id
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        return res.status(409).json({ message: "A pending request already exists for this date" });
      }
      throw error;
    }

    setAuditMeta(res, {
      action: "TEACHER_ATTENDANCE_REQUEST_CREATE",
      resource: "teacher-attendance/request",
      metadata: { requestId: created.id, attendanceDate: created.attendanceDate, requestType: created.requestType }
    });
    return res.status(201).json({ item: created });
  })
);

teacherAttendanceRouter.get(
  "/requests/me",
  requireRoles(["teacher"]),
  asyncHandler(async (req, res) => {
    const parsed = AttendanceRequestListQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request query" });
    const teacher = await getTeacher(req.auth!.userId);
    if (!teacher) return res.status(403).json({ message: "Teacher account is not active" });
    const filter: Record<string, unknown> = { teacherId: teacher._id };
    if (parsed.data.status) filter.status = parsed.data.status;
    const [items, total] = await Promise.all([
      TeacherAttendanceRequestModel.find(filter).sort({ createdAt: -1 }).skip((parsed.data.page - 1) * parsed.data.pageSize).limit(parsed.data.pageSize).lean(),
      TeacherAttendanceRequestModel.countDocuments(filter)
    ]);
    return res.json({ items, total, page: parsed.data.page, pageSize: parsed.data.pageSize, totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)) });
  })
);

teacherAttendanceRouter.get(
  "/admin/requests",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = AttendanceRequestListQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid request query" });
    const filter: Record<string, unknown> = {};
    if (parsed.data.status) filter.status = parsed.data.status;
    const [items, total] = await Promise.all([
      TeacherAttendanceRequestModel.find(filter).sort({ createdAt: -1 }).skip((parsed.data.page - 1) * parsed.data.pageSize).limit(parsed.data.pageSize).lean(),
      TeacherAttendanceRequestModel.countDocuments(filter)
    ]);
    return res.json({ items, total, page: parsed.data.page, pageSize: parsed.data.pageSize, totalPages: Math.max(1, Math.ceil(total / parsed.data.pageSize)) });
  })
);

teacherAttendanceRouter.patch(
  "/admin/requests/:id/review",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = ReviewAttendanceRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid review payload", errors: parsed.error.flatten() });
    const request = await TeacherAttendanceRequestModel.findById(req.params.id);
    if (!request) return res.status(404).json({ message: "Attendance request not found" });
    if (request.status !== "pending") return res.status(409).json({ message: "Request has already been decided" });

    const adminUserId = new mongoose.Types.ObjectId(req.auth!.userId);
    request.status = parsed.data.decision;
    request.decisionNote = parsed.data.decisionNote;
    request.decidedBy = adminUserId;
    request.decidedAt = new Date();
    await request.save();

    let record;
    if (parsed.data.decision === "approved") {
      if (request.requestType === "correction" && request.existingRecordId) {
        record = await TeacherAttendanceRecordModel.findById(request.existingRecordId);
        if (record) {
          if (!record.originalStatus) record.originalStatus = record.status;
          record.status = "corrected";
          record.correctedToStatus = request.requestedStatus;
          record.correctionReason = request.reason;
          record.source = "admin_correction";
          record.updatedBy = adminUserId;
          await record.save();
        }
      } else if (request.requestType === "manual") {
        try {
          record = await TeacherAttendanceRecordModel.create({
            teacherId: request.teacherId,
            attendanceDate: request.attendanceDate,
            checkInAtServer: new Date(`${request.attendanceDate}T00:00:00`),
            status: request.requestedStatus,
            // The day was an absence until this request was approved.
            originalStatus: "absent",
            correctionReason: request.reason,
            source: "manual_application",
            createdBy: request.teacherUserId,
            updatedBy: adminUserId
          });
        } catch (error) {
          if ((error as { code?: number }).code === 11000) {
            return res.status(409).json({ message: "Attendance was already marked for this date before approval" });
          }
          throw error;
        }
      }
    }

    setAuditMeta(res, {
      action: "TEACHER_ATTENDANCE_REQUEST_REVIEW",
      resource: "teacher-attendance/request",
      metadata: { requestId: request.id, decision: parsed.data.decision, requestType: request.requestType }
    });
    return res.json({ item: request, record });
  })
);
