import mongoose from "mongoose";
import { getLeaveSettings } from "../../models/leave-settings.model.js";
import { LeaveRequestModel } from "../../models/leave-request.model.js";
import { TeacherAttendanceRecordModel } from "../../models/teacher-attendance.model.js";
import { TeacherAttendanceRequestModel } from "../../models/teacher-attendance-request.model.js";
import { getTeacherAttendanceSettings } from "../../models/teacher-attendance-settings.model.js";
import {
  buildDayCalendar,
  enumerateDays,
  resolveDay,
  schoolDateKey,
  schoolMinutes,
  timeToMinutes,
  type ResolvedDay
} from "./attendance-day.js";

export type DayRow = ResolvedDay & {
  teacherId: string;
  teacherName: string;
  classId: string | null;
  className: string;
  attendanceDate: string;
  record: Record<string, unknown> | null;
  pendingRequestId: string | null;
  leaveRequestId: string | null;
};

type TeacherLike = {
  _id: mongoose.Types.ObjectId;
  fullName: string;
  classId?: unknown;
};

function readClass(teacher: TeacherLike): { classId: string | null; className: string } {
  const value = teacher.classId;
  if (value && typeof value === "object" && "name" in value) {
    const populated = value as { _id: mongoose.Types.ObjectId; name: string };
    return { classId: String(populated._id), className: populated.name };
  }
  return { classId: value ? String(value) : null, className: "" };
}

export async function loadAttendanceContext() {
  const [attendanceSettings, leaveSettings] = await Promise.all([
    getTeacherAttendanceSettings(),
    getLeaveSettings()
  ]);
  const timezone = attendanceSettings.timezone || "Asia/Kolkata";
  return {
    settings: attendanceSettings,
    calendar: buildDayCalendar(leaveSettings),
    timezone,
    today: schoolDateKey(timezone),
    nowMinutes: schoolMinutes(timezone),
    finalizeMinutes: timeToMinutes(attendanceSettings.markWindowEnd)
  };
}

/**
 * Builds one resolved status per teacher per date. Every screen reads from here
 * so attendance, leave, corrections and reports can never disagree.
 */
export async function buildDayRows(input: {
  teachers: TeacherLike[];
  from: string;
  to: string;
}): Promise<{ rows: DayRow[]; context: Awaited<ReturnType<typeof loadAttendanceContext>> }> {
  const context = await loadAttendanceContext();
  const teacherIds = input.teachers.map((teacher) => teacher._id);
  const dates = enumerateDays(input.from, input.to);

  const [records, leaves, pendingRequests] = await Promise.all([
    TeacherAttendanceRecordModel.find({
      teacherId: { $in: teacherIds },
      attendanceDate: { $gte: input.from, $lte: input.to }
    }).lean(),
    LeaveRequestModel.find({
      teacherId: { $in: teacherIds },
      status: { $in: ["approved", "partially_approved"] },
      activeDates: { $elemMatch: { $gte: input.from, $lte: input.to } }
    }).lean(),
    TeacherAttendanceRequestModel.find({
      teacherId: { $in: teacherIds },
      attendanceDate: { $gte: input.from, $lte: input.to },
      status: "pending"
    }).lean()
  ]);

  const recordMap = new Map(records.map((record) => [`${record.teacherId}:${record.attendanceDate}`, record]));
  const requestMap = new Map(pendingRequests.map((request) => [`${request.teacherId}:${request.attendanceDate}`, request]));
  const leaveMap = new Map<string, string>();
  for (const leave of leaves) {
    for (const date of leave.activeDates) {
      if (date >= input.from && date <= input.to) leaveMap.set(`${leave.teacherId}:${date}`, String(leave._id));
    }
  }

  const rows: DayRow[] = [];
  for (const teacher of input.teachers) {
    const { classId, className } = readClass(teacher);
    for (const date of dates) {
      const key = `${teacher._id}:${date}`;
      const record = recordMap.get(key) ?? null;
      const pendingRequest = requestMap.get(key) ?? null;
      const leaveRequestId = leaveMap.get(key) ?? null;
      const resolved = resolveDay({
        date,
        today: context.today,
        nowMinutes: context.nowMinutes,
        finalizeMinutes: context.finalizeMinutes,
        calendar: context.calendar,
        record: record
          ? {
              status: record.status,
              correctedToStatus: record.correctedToStatus ?? null,
              conflictResolution: record.conflictResolution ?? null,
              originalStatus: record.originalStatus ?? null
            }
          : null,
        onApprovedLeave: Boolean(leaveRequestId),
        hasPendingCorrection: Boolean(pendingRequest)
      });

      rows.push({
        ...resolved,
        teacherId: String(teacher._id),
        teacherName: teacher.fullName,
        classId,
        className,
        attendanceDate: date,
        record: record as Record<string, unknown> | null,
        pendingRequestId: pendingRequest ? String(pendingRequest._id) : null,
        leaveRequestId
      });
    }
  }

  return { rows, context };
}

export function summariseRows(rows: DayRow[]) {
  const summary: Record<string, number> = {};
  for (const row of rows) summary[row.status] = (summary[row.status] ?? 0) + 1;
  return summary;
}
