import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { ClassModel } from "../../models/class.model.js";
import { NOTIFICATION_STATUS_LABELS } from "./notification.templates.js";
import { NOTIFIABLE_STATUSES, NotificationModel, type NotifiableStatus } from "../../models/notification.model.js";
import { StudentModel } from "../../models/student.model.js";

type AttendanceEntry = {
  studentId: mongoose.Types.ObjectId | string;
  status: string;
};

export type AttendanceSnapshot = {
  _id: mongoose.Types.ObjectId | string;
  classId: mongoose.Types.ObjectId | string;
  attendanceDate: Date;
  entries: AttendanceEntry[];
};

function isNotifiable(status: string): status is NotifiableStatus {
  return (NOTIFIABLE_STATUSES as readonly string[]).includes(status);
}

function formatDate(date: Date) {
  // Attendance dates are stored at local midnight, so format locally - toISOString()
  // would report the previous day for any timezone ahead of UTC.
  const value = new Date(date);
  return `${String(value.getDate()).padStart(2, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${value.getFullYear()}`;
}

/**
 * Digits-only phone number, suitable for a wa.me deep link.
 * Numbers without a country code are assumed to be Indian (+91).
 */
export function normalizePhoneNumber(raw: string | undefined | null) {
  if (!raw) {
    return "";
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) {
    return "";
  }

  if (digits.length === 10) {
    return `91${digits}`;
  }

  return digits.replace(/^0+/, "");
}

export function buildWhatsAppLink(phoneNumber: string, message: string) {
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) {
    return "";
  }

  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * Creates (or refreshes) one WhatsApp notification per absent-like student for the
 * given attendance record. Safe to call repeatedly - existing rows are updated in
 * place while rows that are no longer applicable are removed.
 */
export async function syncNotificationsForAttendance(attendance: AttendanceSnapshot) {
  const flagged = attendance.entries.filter((entry) => isNotifiable(entry.status));
  const attendanceDate = new Date(attendance.attendanceDate);
  const attendanceId = new mongoose.Types.ObjectId(String(attendance._id));
  const classId = new mongoose.Types.ObjectId(String(attendance.classId));
  const flaggedIds = flagged.map((entry) => new mongoose.Types.ObjectId(String(entry.studentId)));

  // Students who were corrected back to "present" should no longer be pending.
  await NotificationModel.deleteMany({
    attendanceDate,
    classId,
    state: "pending",
    studentId: { $nin: flaggedIds }
  });

  if (flagged.length === 0) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const [classDoc, students] = await Promise.all([
    ClassModel.findById(classId).lean(),
    StudentModel.find({ _id: { $in: flaggedIds } })
      .select("fullName fatherName motherName phoneNumber")
      .lean()
  ]);

  const studentById = new Map(students.map((student) => [String(student._id), student]));

  const className = classDoc?.name ?? "-";
  const dateLabel = formatDate(attendanceDate);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const entry of flagged) {
    const student = studentById.get(String(entry.studentId));
    if (!student) {
      skipped += 1;
      continue;
    }

    const status = entry.status as NotifiableStatus;
    const hasContact = normalizePhoneNumber(student.phoneNumber);
    const guardianName = student.fatherName || student.motherName || "";

    const context = {
      schoolName: env.SCHOOL_NAME,
      studentName: student.fullName,
      className,
      dateLabel,
      status
    };

    const result = await NotificationModel.updateOne(
      { studentId: student._id, attendanceDate },
      {
        $set: {
          attendanceId,
          classId,
          studentName: student.fullName,
          parentName: hasContact ? guardianName : undefined,
          phoneNumber: hasContact ? student.phoneNumber : "",
          status,
          messageEn: NOTIFICATION_STATUS_LABELS.en(context),
          messageHi: NOTIFICATION_STATUS_LABELS.hi(context)
        },
        $setOnInsert: { attendanceDate, studentId: student._id, channel: "whatsapp", state: "pending" }
      },
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      created += 1;
    } else {
      updated += 1;
    }
  }

  return { created, updated, skipped };
}

/** Never let notification bookkeeping break an attendance write. */
export async function syncNotificationsSafely(attendance: AttendanceSnapshot) {
  try {
    return await syncNotificationsForAttendance(attendance);
  } catch (error) {
    logger.error("Failed to sync absence notifications", {
      attendanceId: String(attendance._id),
      message: error instanceof Error ? error.message : "unknown error"
    });
    return null;
  }
}
