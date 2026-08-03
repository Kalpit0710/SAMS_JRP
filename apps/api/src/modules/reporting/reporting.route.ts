import mongoose from "mongoose";
import { Router } from "express";
import PDFDocument from "pdfkit";
import { asyncHandler } from "../../lib/async-handler.js";
import { buildCsv, sendCsv } from "../../lib/csv.js";
import { env } from "../../config/env.js";
import { setAuditMeta } from "../../middleware/audit-log.middleware.js";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware.js";
import { AttendanceModel } from "../../models/attendance.model.js";
import { ClassModel } from "../../models/class.model.js";
import { StudentModel } from "../../models/student.model.js";
import { TeacherModel } from "../../models/teacher.model.js";

const PRESENT_LIKE_STATUSES = ["present", "late", "half_day"];

const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "late",
  "half_day"
] as const;

type AttendanceStatusKey = (typeof ATTENDANCE_STATUSES)[number];
type StatusCounts = Record<AttendanceStatusKey, number>;

type ClassAbsenceRow = {
  _id: {
    classId: mongoose.Types.ObjectId;
    studentId: mongoose.Types.ObjectId;
  };
  absenceCount: number;
};

type SchoolAbsenceRow = {
  _id: mongoose.Types.ObjectId;
  classId: mongoose.Types.ObjectId;
  absenceCount: number;
};

function emptyStatusCounts(): StatusCounts {
  return {
    present: 0,
    absent: 0,
    late: 0,
    half_day: 0
  };
}

function sumStatuses(counts: StatusCounts): number {
  return ATTENDANCE_STATUSES.reduce((sum, status) => sum + counts[status], 0);
}

type TimelineItem = {
  _id: mongoose.Types.ObjectId;
  classId: mongoose.Types.ObjectId;
  attendanceDate: Date;
  submittedBy: mongoose.Types.ObjectId;
  entries: Array<{
    studentId: mongoose.Types.ObjectId;
    status: string;
  }>;
};

export const reportingRouter = Router();

reportingRouter.use(requireAuth);

function normalizeDate(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Dates are stored at local midnight, so format them locally - toISOString() would
 *  roll back a day for any timezone ahead of UTC. */
function toDateKey(value: Date): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDays(raw: unknown): number {
  if (typeof raw !== "string") {
    return 30;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return 30;
  }

  return Math.min(90, Math.max(7, Math.floor(parsed)));
}

function parsePage(query: Record<string, unknown>) {
  const pageRaw = typeof query.page === "string" ? Number(query.page) : 1;
  const pageSizeRaw = typeof query.pageSize === "string" ? Number(query.pageSize) : 20;

  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(100, Math.max(1, Math.floor(pageSizeRaw))) : 20;

  return { page, pageSize };
}

async function resolveTeacherClassFilter(userId: string): Promise<mongoose.Types.ObjectId[]> {
  const teacher = await TeacherModel.findOne({ userId: new mongoose.Types.ObjectId(userId), isActive: true }).select("classId");
  if (!teacher?.classId) {
    return [];
  }

  return [teacher.classId];
}

async function resolveReportScope(req: {
  auth?: { userId: string; activeRole: string };
  query: Record<string, unknown>;
}) {
  const classIdRaw = typeof req.query.classId === "string" ? req.query.classId : undefined;

  if (classIdRaw && !mongoose.Types.ObjectId.isValid(classIdRaw)) {
    throw new Error("Invalid classId");
  }

  const classId = classIdRaw ? new mongoose.Types.ObjectId(classIdRaw) : undefined;

  let teacherClassIds: mongoose.Types.ObjectId[] | undefined;
  if (req.auth?.activeRole === "teacher") {
    teacherClassIds = await resolveTeacherClassFilter(req.auth.userId);
  }

  if (classId && teacherClassIds && !teacherClassIds.some((item) => item.toString() === classId.toString())) {
    throw new Error("Teacher is not assigned to this class");
  }

  return { classId, teacherClassIds };
}

async function loadActiveStudents(scope: { classId?: mongoose.Types.ObjectId; teacherClassIds?: mongoose.Types.ObjectId[] }) {
  const studentQuery: Record<string, unknown> = { status: "active" };

  if (scope.classId) {
    studentQuery.classId = scope.classId;
  } else if (scope.teacherClassIds) {
    studentQuery.classId = { $in: scope.teacherClassIds };
  }

  const students = await StudentModel.find(studentQuery).select("_id classId fullName rollNumber");
  const studentIds = students.map((student) => student._id);
  const studentIdSet = new Set(studentIds.map((id) => id.toString()));

  return { students, studentIds, studentIdSet };
}

function buildAttendanceMatch(scope: { classId?: mongoose.Types.ObjectId; teacherClassIds?: mongoose.Types.ObjectId[] }, fromDate?: Date, toDate?: Date) {
  const attendanceMatch: Record<string, unknown> = {};

  if (fromDate || toDate) {
    attendanceMatch.attendanceDate = {
      ...(fromDate ? { $gte: fromDate } : {}),
      ...(toDate ? { $lte: toDate } : {})
    };
  }

  if (scope.classId) {
    attendanceMatch.classId = scope.classId;
  } else if (scope.teacherClassIds) {
    attendanceMatch.classId = { $in: scope.teacherClassIds };
  }

  return attendanceMatch;
}

reportingRouter.get(
  "/overview",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const days = parseDays(req.query.days);

    let scope;
    try {
      scope = await resolveReportScope({ auth: req.auth, query: req.query as Record<string, unknown> });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid query";
      const status = message.includes("assigned") ? 403 : 400;
      return res.status(status).json({ message });
    }

    if (scope.teacherClassIds && scope.teacherClassIds.length === 0) {
      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        totals: { students: 0, classes: 0, todayMarked: 0, todayPresentLike: 0, todayRate: 0 },
        today: { date: toDateKey(new Date()), status: emptyStatusCounts() },
        previous: null,
        trend: [],
        statusBreakdown: [],
        classHealth: [],
        absenceInsights: { byClass: [] }
      });
    }

    const { students, studentIds } = await loadActiveStudents(scope);
    const uniqueClassIds = new Set(students.map((student) => student.classId.toString()));

    const today = normalizeDate(new Date());
    const fromDate = normalizeDate(new Date(today));
    fromDate.setDate(fromDate.getDate() - (days - 1));

    const attendanceMatch = buildAttendanceMatch(scope, fromDate, today);
    const isAdmin = req.auth?.activeRole === "admin";
    const schoolAttendanceMatch = buildAttendanceMatch({}, fromDate, today);

    const [dailyStatusRows, trendRows, statusRows, classRows, classAbsenceRows, schoolAbsenceRows, classes] = await Promise.all([
      AttendanceModel.aggregate<{ _id: { date: Date; status: string }; count: number }>([
        { $match: attendanceMatch },
        { $unwind: "$entries" },
        { $match: { "entries.status": { $in: ATTENDANCE_STATUSES } } },
        { $group: { _id: { date: "$attendanceDate", status: "$entries.status" }, count: { $sum: 1 } } }
      ]),
      AttendanceModel.aggregate<{ _id: Date; total: number; presentLike: number }>([
        { $match: attendanceMatch },
        { $unwind: "$entries" },
        { $match: { "entries.status": { $in: ATTENDANCE_STATUSES } } },
        {
          $group: {
            _id: "$attendanceDate",
            total: { $sum: 1 },
            presentLike: {
              $sum: { $cond: [{ $in: ["$entries.status", PRESENT_LIKE_STATUSES] }, 1, 0] }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      AttendanceModel.aggregate<{ _id: string; count: number }>([
        { $match: attendanceMatch },
        { $unwind: "$entries" },
        { $match: { "entries.status": { $in: ATTENDANCE_STATUSES } } },
        { $group: { _id: "$entries.status", count: { $sum: 1 } } },
        { $sort: { count: -1 as -1 } }
      ]),
      AttendanceModel.aggregate<{ _id: mongoose.Types.ObjectId; total: number; presentLike: number }>([
        { $match: attendanceMatch },
        { $unwind: "$entries" },
        { $match: { "entries.status": { $in: ATTENDANCE_STATUSES } } },
        {
          $group: {
            _id: "$classId",
            total: { $sum: 1 },
            presentLike: {
              $sum: { $cond: [{ $in: ["$entries.status", PRESENT_LIKE_STATUSES] }, 1, 0] }
            }
          }
        }
      ]),
      AttendanceModel.aggregate<ClassAbsenceRow>([
        { $match: attendanceMatch },
        { $unwind: "$entries" },
        { $match: { "entries.status": "absent" } },
        {
          $group: {
            _id: { classId: "$classId", studentId: "$entries.studentId" },
            absenceCount: { $sum: 1 }
          }
        }
      ]),
      isAdmin
        ? AttendanceModel.aggregate<SchoolAbsenceRow>([
            { $match: schoolAttendanceMatch },
            { $unwind: "$entries" },
            { $match: { "entries.status": "absent" } },
            { $sort: { attendanceDate: 1 } },
            {
              $group: {
                _id: "$entries.studentId",
                classId: { $last: "$classId" },
                absenceCount: { $sum: 1 }
              }
            }
          ])
        : Promise.resolve([] as SchoolAbsenceRow[]),
      ClassModel.find(scope.teacherClassIds ? { _id: { $in: scope.teacherClassIds } } : {}).select("_id name")
    ]);

    const rankedStudentIds = Array.from(new Set([
      ...classAbsenceRows.map((row) => row._id.studentId.toString()),
      ...schoolAbsenceRows.map((row) => row._id.toString())
    ])).map((id) => new mongoose.Types.ObjectId(id));
    const rankedStudents = rankedStudentIds.length > 0
      ? await StudentModel.find({ _id: { $in: rankedStudentIds } }).select("_id classId fullName rollNumber")
      : [];

    const statusByDate = new Map<string, StatusCounts>();
    for (const row of dailyStatusRows) {
      const key = toDateKey(row._id.date);
      const bucket = statusByDate.get(key) ?? emptyStatusCounts();
      if (row._id.status in bucket) {
        bucket[row._id.status as AttendanceStatusKey] += row.count;
      }
      statusByDate.set(key, bucket);
    }

    const todayKey = toDateKey(today);
    // "Previous" is the last day attendance was actually marked, not literally yesterday.
    const previousDate = Array.from(statusByDate.keys())
      .filter((key) => key < todayKey)
      .sort()
      .pop() ?? null;

    const todayStatus = statusByDate.get(todayKey) ?? emptyStatusCounts();
    const previousStatus = previousDate ? statusByDate.get(previousDate) ?? emptyStatusCounts() : null;

    const todayMarked = sumStatuses(todayStatus);
    const todayPresentLike = PRESENT_LIKE_STATUSES.reduce(
      (sum, status) => sum + todayStatus[status as AttendanceStatusKey],
      0
    );

    const classMap = new Map(classes.map((item) => [item._id.toString(), item]));
    const studentMap = new Map(rankedStudents.map((item) => [item._id.toString(), item]));

    const rankItems = <TRow extends { absenceCount: number }>(items: Array<TRow & {
      studentId: mongoose.Types.ObjectId;
      classId: mongoose.Types.ObjectId;
    }>) => items
      .flatMap((item) => {
        const student = studentMap.get(item.studentId.toString());
        const classInfo = classMap.get(item.classId.toString());
        if (!student || !classInfo) {
          return [];
        }

        return [{
          studentId: item.studentId,
          studentName: student.fullName,
          rollNumber: student.rollNumber,
          classId: item.classId,
          className: classInfo.name,
          absenceCount: item.absenceCount
        }];
      })
      .sort((a, b) => b.absenceCount - a.absenceCount || a.studentName.localeCompare(b.studentName))
      .slice(0, 3);

    const insightClasses = scope.classId
      ? classes.filter((item) => item._id.toString() === scope.classId?.toString())
      : classes;
    const byClass = insightClasses.map((classInfo) => ({
      classId: classInfo._id,
      className: classInfo.name,
      students: rankItems(classAbsenceRows
        .filter((row) => row._id.classId.toString() === classInfo._id.toString())
        .map((row) => ({
          studentId: row._id.studentId,
          classId: row._id.classId,
          absenceCount: row.absenceCount
        })))
    }));

    const schoolTop = isAdmin
      ? rankItems(schoolAbsenceRows.map((row) => {
          return {
            studentId: row._id,
            classId: row.classId,
            absenceCount: row.absenceCount
          };
        }))
      : undefined;

    const trend = trendRows.map((item) => ({
      date: toDateKey(item._id),
      total: item.total,
      presentLike: item.presentLike,
      rate: item.total === 0 ? 0 : Number(((item.presentLike / item.total) * 100).toFixed(1))
    }));

    const statusBreakdown = statusRows.map((item) => ({ status: item._id, count: item.count }));

    const classHealth = classRows
      .flatMap((item) => {
        const classInfo = classMap.get(item._id.toString());
        if (!classInfo) {
          return [];
        }

        const rate = item.total === 0 ? 0 : Number(((item.presentLike / item.total) * 100).toFixed(1));

        return [{
          classId: item._id,
          className: classInfo.name,
          academicSession: env.ACADEMIC_SESSION,
          total: item.total,
          presentLike: item.presentLike,
          rate
        }];
      })
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 5);

    setAuditMeta(res, {
      action: "REPORT_OVERVIEW_VIEW",
      resource: "reports",
      metadata: { days }
    });

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      totals: {
        students: studentIds.length,
        classes: uniqueClassIds.size,
        todayMarked,
        todayPresentLike,
        todayRate: todayMarked === 0 ? 0 : Number(((todayPresentLike / todayMarked) * 100).toFixed(1))
      },
      today: { date: todayKey, status: todayStatus },
      previous: previousDate ? { date: previousDate, status: previousStatus } : null,
      trend,
      statusBreakdown,
      classHealth,
      absenceInsights: {
        byClass,
        ...(schoolTop ? { schoolTop } : {})
      }
    });
  })
);

reportingRouter.get(
  "/timeline",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const { page, pageSize } = parsePage(query);

    let scope;
    try {
      scope = await resolveReportScope({ auth: req.auth, query });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid query";
      const status = message.includes("assigned") ? 403 : 400;
      return res.status(status).json({ message });
    }

    const statusFilter = typeof query.status === "string" ? query.status : undefined;
    const fromRaw = typeof query.fromDate === "string" ? query.fromDate : undefined;
    const toRaw = typeof query.toDate === "string" ? query.toDate : undefined;

    const fromDate = fromRaw ? normalizeDate(new Date(fromRaw)) : undefined;
    const toDate = toRaw ? normalizeDate(new Date(toRaw)) : undefined;

    if (fromDate && Number.isNaN(fromDate.getTime())) {
      return res.status(400).json({ message: "Invalid fromDate" });
    }

    if (toDate && Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ message: "Invalid toDate" });
    }

    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      return res.status(400).json({ message: "fromDate must be on or before toDate" });
    }

    if (statusFilter && !ATTENDANCE_STATUSES.includes(statusFilter as AttendanceStatusKey)) {
      return res.status(400).json({ message: "Invalid status filter" });
    }

    const attendanceMatch = buildAttendanceMatch(scope, fromDate, toDate);
    if (statusFilter) {
      attendanceMatch["entries.status"] = statusFilter;
    }

    const [total, docs, classes] = await Promise.all([
      AttendanceModel.countDocuments(attendanceMatch),
      AttendanceModel.find(attendanceMatch)
        .sort({ attendanceDate: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .select("classId attendanceDate entries submittedBy"),
      ClassModel.find().select("_id name")
    ]);

    const classMap = new Map(classes.map((item) => [item._id.toString(), item]));

    const items = (docs as TimelineItem[]).map((item) => {
      const classInfo = classMap.get(item.classId.toString());
      const totalMarked = item.entries.length;
      const presentLike = item.entries.filter((entry) => PRESENT_LIKE_STATUSES.includes(entry.status)).length;

      return {
        id: item._id,
        attendanceDate: toDateKey(item.attendanceDate),
        classId: item.classId,
        className: classInfo?.name ?? "Unknown Class",
        session: env.ACADEMIC_SESSION,
        totalMarked,
        presentLike,
        rate: totalMarked === 0 ? 0 : Number(((presentLike / totalMarked) * 100).toFixed(1))
      };
    });

    setAuditMeta(res, {
      action: "REPORT_TIMELINE_VIEW",
      resource: "reports",
      metadata: { page, pageSize, statusFilter }
    });

    return res.status(200).json({
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items
    });
  })
);

reportingRouter.get(
  "/export",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, unknown>;
    const format = typeof query.format === "string" ? query.format.toLowerCase() : "csv";

    if (!["csv", "pdf"].includes(format)) {
      return res.status(400).json({ message: "format must be csv or pdf" });
    }

    let scope;
    try {
      scope = await resolveReportScope({ auth: req.auth, query });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid query";
      const status = message.includes("assigned") ? 403 : 400;
      return res.status(status).json({ message });
    }

    const fromRaw = typeof query.fromDate === "string" ? query.fromDate : undefined;
    const toRaw = typeof query.toDate === "string" ? query.toDate : undefined;

    const fromDate = fromRaw ? normalizeDate(new Date(fromRaw)) : undefined;
    const toDate = toRaw ? normalizeDate(new Date(toRaw)) : undefined;

    if (fromDate && Number.isNaN(fromDate.getTime())) {
      return res.status(400).json({ message: "Invalid fromDate" });
    }

    if (toDate && Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ message: "Invalid toDate" });
    }

    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      return res.status(400).json({ message: "fromDate must be on or before toDate" });
    }

    const statusFilter = typeof query.status === "string" && query.status ? query.status : undefined;
    if (statusFilter && !ATTENDANCE_STATUSES.includes(statusFilter as AttendanceStatusKey)) {
      return res.status(400).json({ message: "Invalid status filter" });
    }

    const attendanceMatch = buildAttendanceMatch(scope, fromDate, toDate);
    if (statusFilter) {
      attendanceMatch["entries.status"] = statusFilter;
    }

    const [docs, classes] = await Promise.all([
      AttendanceModel.find(attendanceMatch).sort({ attendanceDate: -1 }).select("classId attendanceDate entries"),
      ClassModel.find().select("_id name")
    ]);

    const classMap = new Map(classes.map((item) => [item._id.toString(), item]));

    const rows = (docs as TimelineItem[]).map((item) => {
      const classInfo = classMap.get(item.classId.toString());
      const totalMarked = item.entries.length;
      const presentLike = item.entries.filter((entry) => PRESENT_LIKE_STATUSES.includes(entry.status)).length;
      const rate = totalMarked === 0 ? 0 : Number(((presentLike / totalMarked) * 100).toFixed(1));

      return {
        date: toDateKey(item.attendanceDate),
        class: classInfo?.name ?? "Unknown",
        session: env.ACADEMIC_SESSION,
        totalMarked,
        presentLike,
        rate
      };
    });

    setAuditMeta(res, {
      action: "REPORT_EXPORT",
      resource: "reports",
      metadata: { format, rowCount: rows.length }
    });

    if (format === "csv") {
      const csv = buildCsv(
        ["date", "class", "session", "totalMarked", "presentLike", "rate"],
        rows as unknown as Array<Record<string, unknown>>
      );
      return sendCsv(res, "attendance-report.csv", csv);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=attendance-report.pdf");

    const pdf = new PDFDocument({ margin: 32, size: "A4" });
    pdf.pipe(res);

    pdf.fontSize(18).text("Attendance Timeline Report");
    pdf.moveDown(0.5);
    pdf.fontSize(10).fillColor("#6b7280").text(`Generated: ${new Date().toISOString()}`);
    pdf.fillColor("#111827");
    pdf.moveDown();

    if (rows.length === 0) {
      pdf.fontSize(11).text("No rows found for selected filters.");
      pdf.end();
      return;
    }

    for (const row of rows.slice(0, 250)) {
      pdf
        .fontSize(10)
        .text(`${row.date} | ${row.class} | Rate ${row.rate}% | Marked ${row.totalMarked}`);
    }

    if (rows.length > 250) {
      pdf.moveDown().fontSize(10).fillColor("#b91c1c").text(`Truncated ${rows.length - 250} additional rows for PDF readability.`);
    }

    pdf.end();
  })
);
