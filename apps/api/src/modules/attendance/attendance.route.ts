import mongoose from "mongoose";
import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { setAuditMeta } from "../../middleware/audit-log.middleware.js";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware.js";
import { AttendanceModel } from "../../models/attendance.model.js";
import { AttendanceSettingsModel, getAttendanceLockMinutes } from "../../models/attendance-settings.model.js";
import { ClassModel } from "../../models/class.model.js";
import { StudentModel } from "../../models/student.model.js";
import { TeacherModel } from "../../models/teacher.model.js";
import { syncNotificationsSafely } from "../notifications/notification.service.js";
import { EditAttendanceSchema, SubmitAttendanceSchema } from "./attendance.schema.js";

export const attendanceRouter = Router();

attendanceRouter.use(requireAuth);

async function ensureTeacherClassAccess(userId: string, classId: string): Promise<boolean> {
  const teacher = await TeacherModel.findOne({ userId: new mongoose.Types.ObjectId(userId), isActive: true });
  if (!teacher?.classId) {
    return false;
  }

  return teacher.classId.toString() === classId;
}

function normalizeDate(dateString: string): Date {
  const date = new Date(dateString);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function countStatuses(entries: Array<{ status: string }>) {
  const counts = { present: 0, absent: 0, late: 0, half_day: 0 };
  for (const entry of entries) {
    if (entry.status in counts) {
      counts[entry.status as keyof typeof counts] += 1;
    }
  }
  return counts;
}

function buildEntriesMap(entries: { studentId: string }[]) {
  const ids = entries.map((entry) => entry.studentId);
  return new Set(ids);
}

async function getAcademicYearForDate(attendanceDate: Date): Promise<string | null> {
  const settings = await AttendanceSettingsModel.findOne();
  const startMonth = settings?.academicYearStartMonth ?? 4;
  const startDay = settings?.academicYearStartDay ?? 1;
  const year = attendanceDate.getUTCFullYear();
  const month = attendanceDate.getUTCMonth() + 1;
  const day = attendanceDate.getUTCDate();
  const startDate = new Date(Date.UTC(year, startMonth - 1, startDay));
  const endDate = new Date(Date.UTC(year + 1, startMonth - 1, startDay));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  if (attendanceDate >= startDate && attendanceDate <= endDate) {
    return `${year}-${year + 1}`;
  }
  const prevYear = year - 1;
  const prevStartDate = new Date(Date.UTC(prevYear, startMonth - 1, startDay));
  const prevEndDate = new Date(Date.UTC(year, startMonth - 1, startDay));
  prevEndDate.setUTCDate(prevEndDate.getUTCDate() - 1);
  if (attendanceDate >= prevStartDate && attendanceDate <= prevEndDate) {
    return `${prevYear}-${year}`;
  }
  return null;
}

async function ensureArchivedYearIsWritable(attendanceDate: Date): Promise<void> {
  const academicYear = await getAcademicYearForDate(attendanceDate);
  if (!academicYear) {
    return;
  }

  const archive = await import("../../models/student-academic-year-archive.model.js").then((module) => module.StudentAcademicYearArchiveModel.findOne({
    academicYear,
    $or: [
      { monthly: { $elemMatch: { totalMarkedDays: { $gt: 0 } } } },
      { totals: { $exists: true } }
    ]
  }).lean());

  if (archive) {
    throw Object.assign(new Error("Attendance for a finalized academic year cannot be changed"), { statusCode: 409 });
  }
}

attendanceRouter.post(
  "/submit",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const parsed = SubmitAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid attendance payload", errors: parsed.error.flatten() });
    }

    if (req.auth?.activeRole === "teacher") {
      const hasAccess = await ensureTeacherClassAccess(req.auth.userId, parsed.data.classId);
      if (!hasAccess) {
        return res.status(403).json({ message: "Teacher is not assigned to this class" });
      }
    }

    const classId = new mongoose.Types.ObjectId(parsed.data.classId);
    const attendanceDate = normalizeDate(parsed.data.attendanceDate);

    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    if (attendanceDate.getTime() > todayMidnight.getTime()) {
      return res.status(400).json({ message: "Cannot record attendance for a future date" });
    }

    await ensureArchivedYearIsWritable(attendanceDate);

    const classDoc = await ClassModel.findById(classId).select("name isActive");
    if (!classDoc) {
      return res.status(404).json({ message: "Class not found" });
    }
    if (classDoc.isActive === false) {
      return res.status(400).json({ message: "Cannot record attendance for an inactive class" });
    }

    const existing = await AttendanceModel.findOne({ classId, attendanceDate });
    if (existing) {
      return res.status(409).json({ message: "Attendance already submitted for this class/date" });
    }

    const students = await StudentModel.find({ classId, status: "active" }).select("_id");
    const studentIds = students.map((student) => student.id);

    const submittedSet = buildEntriesMap(parsed.data.entries);
    const hasDuplicates = submittedSet.size !== parsed.data.entries.length;

    if (hasDuplicates) {
      return res.status(400).json({ message: "Duplicate student entries found in attendance payload" });
    }

    if (submittedSet.size !== studentIds.length || studentIds.some((id) => !submittedSet.has(id))) {
      return res.status(400).json({ message: "All active students must be marked before submit" });
    }

    const lockMinutes = await getAttendanceLockMinutes();
    const lockedAt = new Date(Date.now() + lockMinutes * 60 * 1000);

    const item = await AttendanceModel.create({
      classId,
      attendanceDate,
      entries: parsed.data.entries.map((entry) => ({
        studentId: new mongoose.Types.ObjectId(entry.studentId),
        status: entry.status,
        note: entry.note
      })),
      submittedBy: new mongoose.Types.ObjectId(req.auth!.userId),
      lastUpdatedBy: new mongoose.Types.ObjectId(req.auth!.userId),
      lockedAt
    });

    const notifications = await syncNotificationsSafely({
      _id: item._id,
      classId: item.classId,
      attendanceDate: item.attendanceDate,
      entries: item.entries
    });

    setAuditMeta(res, {
      action: "ATTENDANCE_SUBMIT",
      resource: "attendance",
      metadata: {
        attendanceId: item.id,
        classId: item.classId.toString(),
        className: classDoc.name,
        attendanceDate: toDateKey(item.attendanceDate),
        studentCount: item.entries.length,
        statusCounts: countStatuses(item.entries),
        notificationsCreated: notifications?.created ?? 0
      }
    });

    return res.status(201).json({ item, notifications });
  })
);

attendanceRouter.patch(
  "/:attendanceId",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const parsed = EditAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid attendance update payload", errors: parsed.error.flatten() });
    }

    const item = await AttendanceModel.findById(req.params.attendanceId);
    if (!item) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    await ensureArchivedYearIsWritable(item.attendanceDate);

    const previousEntries = new Map(item.entries.map((entry) => [entry.studentId.toString(), {
      status: entry.status,
      note: entry.note ?? null
    }]));

    if (req.auth?.activeRole === "teacher") {
      const hasAccess = await ensureTeacherClassAccess(req.auth.userId, item.classId.toString());
      if (!hasAccess) {
        return res.status(403).json({ message: "Teacher is not assigned to this class" });
      }

      if (new Date() > item.lockedAt) {
        return res.status(423).json({ message: "Attendance is locked for teacher edits" });
      }
    }

    // Edits validate against the students already recorded, not today's active roster,
    // so a historical record stays correctable after a student is deactivated/deleted/moved.
    const recordStudentIds = item.entries.map((entry) => entry.studentId.toString());
    const submittedSet = buildEntriesMap(parsed.data.entries);
    const hasDuplicates = submittedSet.size !== parsed.data.entries.length;

    if (hasDuplicates) {
      return res.status(400).json({ message: "Duplicate student entries found in attendance payload" });
    }

    if (submittedSet.size !== recordStudentIds.length || recordStudentIds.some((id) => !submittedSet.has(id))) {
      return res.status(400).json({ message: "Submitted students must match the recorded students" });
    }

    const changes = parsed.data.entries.flatMap((entry) => {
      const previous = previousEntries.get(entry.studentId);
      const nextNote = entry.note ?? null;
      if (!previous || (previous.status === entry.status && previous.note === nextNote)) {
        return [];
      }
      return [{
        studentId: entry.studentId,
        previousStatus: previous.status,
        status: entry.status,
        previousNote: previous.note,
        note: nextNote
      }];
    });
    const changedStudents = changes.length > 0
      ? await StudentModel.find({ _id: { $in: changes.map((change) => change.studentId) } }).select("fullName").lean()
      : [];
    const changedStudentNames = new Map(changedStudents.map((student) => [student._id.toString(), student.fullName]));

    item.set("entries", parsed.data.entries.map((entry) => ({
      studentId: new mongoose.Types.ObjectId(entry.studentId),
      status: entry.status,
      note: entry.note
    })));
    item.lastUpdatedBy = new mongoose.Types.ObjectId(req.auth!.userId);

    await item.save();

    const notifications = await syncNotificationsSafely({
      _id: item._id,
      classId: item.classId,
      attendanceDate: item.attendanceDate,
      entries: item.entries
    });
    const classDoc = await ClassModel.findById(item.classId).select("name");

    setAuditMeta(res, {
      action: "ATTENDANCE_EDIT",
      resource: "attendance",
      metadata: {
        attendanceId: item.id,
        classId: item.classId.toString(),
        className: classDoc?.name,
        attendanceDate: toDateKey(item.attendanceDate),
        studentCount: item.entries.length,
        statusCounts: countStatuses(item.entries),
        changedEntries: changes.length,
        changes: changes.map((change) => ({
          ...change,
          studentName: changedStudentNames.get(change.studentId) ?? ""
        })),
        notificationsCreated: notifications?.created ?? 0
      }
    });

    return res.status(200).json({ item, notifications });
  })
);

attendanceRouter.get(
  "/class/:classId",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const { classId: classIdParam } = req.params as { classId: string };

    if (!mongoose.isValidObjectId(classIdParam)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    if (req.auth?.activeRole === "teacher") {
      const hasAccess = await ensureTeacherClassAccess(req.auth.userId, classIdParam);
      if (!hasAccess) {
        return res.status(403).json({ message: "Teacher is not assigned to this class" });
      }
    }

    const classId = new mongoose.Types.ObjectId(classIdParam);

    const attendanceDate = typeof req.query.date === "string"
      ? normalizeDate(req.query.date)
      : normalizeDate(new Date().toISOString());

    const item = await AttendanceModel.findOne({ classId, attendanceDate });

    // Return the students actually on the record (looked up by id, ignoring current
    // active status) so an existing record can be edited even after roster changes.
    let students: Array<{ _id: string; fullName: string; rollNumber?: string }> | undefined;
    if (item) {
      const entryIds = item.entries.map((entry) => entry.studentId);
      const studentDocs = await StudentModel.find({ _id: { $in: entryIds } }).select("_id fullName rollNumber");
      const studentMap = new Map(studentDocs.map((doc) => [doc.id as string, doc]));
      students = item.entries.map((entry) => {
        const doc = studentMap.get(entry.studentId.toString());
        return {
          _id: entry.studentId.toString(),
          fullName: doc?.fullName ?? "",
          rollNumber: doc?.rollNumber ?? undefined
        };
      });
    }

    return res.status(200).json({ item, students });
  })
);
