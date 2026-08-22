import mongoose from "mongoose";
import crypto from "node:crypto";
import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { MATCH_NOTHING, resolveTeacherClassId } from "../../lib/teacher-scope.js";
import { setAuditMeta } from "../../middleware/audit-log.middleware.js";
import { requireAuth, requireRoles } from "../../middleware/auth.middleware.js";
import { generateUniqueUsername } from "../../lib/teacher-provisioning.js";
import { AttendanceModel } from "../../models/attendance.model.js";
import { AttendanceSettingsModel } from "../../models/attendance-settings.model.js";
import { ClassModel } from "../../models/class.model.js";
import { DeviceSessionModel } from "../../models/device-session.model.js";
import { NotificationModel } from "../../models/notification.model.js";
import { StudentModel } from "../../models/student.model.js";
import { TeacherModel } from "../../models/teacher.model.js";
import { UserModel, hashPassword } from "../../models/user.model.js";
import {
  CreateClassSchema,
  CreateStudentSchema,
  CreateTeacherSchema,
  ResetPinSchema,
  UpdateLockSchema
} from "./master-data.schema.js";

export const masterDataRouter = Router();

masterDataRouter.use(requireAuth);

function trackMutationAudit(
  res: Parameters<typeof setAuditMeta>[0],
  action: string,
  resource: string,
  metadata?: Record<string, unknown>
) {
  setAuditMeta(res, { action, resource, metadata });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Verifies a referenced document exists; returns a 4xx message or null when valid. */
async function referenceError(
  model: { exists: (filter: Record<string, unknown>) => Promise<unknown> },
  id: string | null | undefined,
  label: string
): Promise<string | null> {
  if (id === undefined || id === null) {
    return null;
  }
  if (!mongoose.isValidObjectId(id)) {
    return `Invalid ${label}`;
  }
  const found = await model.exists({ _id: id });
  return found ? null : `${label} does not exist`;
}

/** Rejects dates in the future or before 1950 so obvious data-entry errors are caught. */
function invalidDob(dob: string | undefined): boolean {
  if (!dob) {
    return false;
  }
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }
  return parsed.getTime() > Date.now() || parsed.getFullYear() < 1950;
}

/** Paginates only when `page` is supplied, so existing unpaged consumers keep working. */
function readListQuery(query: Record<string, unknown>) {
  const rawPage = typeof query.page === "string" ? Number.parseInt(query.page, 10) : Number.NaN;
  const rawPageSize = typeof query.pageSize === "string" ? Number.parseInt(query.pageSize, 10) : Number.NaN;
  const search = typeof query.search === "string" ? query.search.trim() : "";

  return {
    paginated: Number.isFinite(rawPage) && rawPage > 0,
    page: Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1,
    pageSize: Number.isFinite(rawPageSize) ? Math.min(Math.max(rawPageSize, 1), 100) : 20,
    searchRegex: search ? new RegExp(escapeRegex(search), "i") : null
  };
}

type ListModel = {
  find: (filter: Record<string, unknown>) => {
    sort: (order: Record<string, 1 | -1>) => {
      skip: (count: number) => { limit: (count: number) => Promise<unknown[]> };
    } & PromiseLike<unknown[]>;
  };
  countDocuments: (filter: Record<string, unknown>) => Promise<number>;
};

async function respondWithList(
  res: Parameters<typeof setAuditMeta>[0],
  model: ListModel,
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  listQuery: ReturnType<typeof readListQuery>
) {
  if (!listQuery.paginated) {
    const items = await model.find(filter).sort(sort);
    return res.status(200).json({ items, total: items.length, page: 1, pageSize: items.length, totalPages: 1 });
  }

  const [items, total] = await Promise.all([
    model
      .find(filter)
      .sort(sort)
      .skip((listQuery.page - 1) * listQuery.pageSize)
      .limit(listQuery.pageSize),
    model.countDocuments(filter)
  ]);

  return res.status(200).json({
    items,
    total,
    page: listQuery.page,
    pageSize: listQuery.pageSize,
    totalPages: Math.max(1, Math.ceil(total / listQuery.pageSize))
  });
}

masterDataRouter.get(
  "/classes",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const listQuery = readListQuery(req.query as Record<string, unknown>);
    const filter: Record<string, unknown> = {};

    if (req.auth?.activeRole === "teacher") {
      filter._id = (await resolveTeacherClassId(req.auth.userId)) ?? MATCH_NOTHING;
    }

    if (req.query.active === "true") {
      filter.isActive = true;
    }

    if (listQuery.searchRegex) {
      filter.name = listQuery.searchRegex;
    }

    return respondWithList(res, ClassModel as unknown as ListModel, filter, { name: 1 }, listQuery);
  })
);

masterDataRouter.post(
  "/classes",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = CreateClassSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid class payload", errors: parsed.error.flatten() });
    }

    const name = parsed.data.name.trim();
    const duplicate = await ClassModel.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } });
    if (duplicate) {
      return res.status(409).json({ message: "A class with this name already exists" });
    }

    const item = await ClassModel.create({ ...parsed.data, name });
    trackMutationAudit(res, "MASTER_CLASS_CREATE", "master-data/classes", { classId: item.id });
    return res.status(201).json({ item });
  })
);

masterDataRouter.patch(
  "/classes/:id",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = CreateClassSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid class update payload", errors: parsed.error.flatten() });
    }

    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.name !== undefined) {
      const name = parsed.data.name.trim();
      const duplicate = await ClassModel.findOne({
        _id: { $ne: req.params.id },
        name: { $regex: `^${escapeRegex(name)}$`, $options: "i" }
      });
      if (duplicate) {
        return res.status(409).json({ message: "A class with this name already exists" });
      }
      update.name = name;
    }

    const item = await ClassModel.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!item) {
      return res.status(404).json({ message: "Class not found" });
    }

    trackMutationAudit(res, "MASTER_CLASS_UPDATE", "master-data/classes", { classId: item.id });

    return res.status(200).json({ item });
  })
);

masterDataRouter.delete(
  "/classes/:id",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const [studentCount, teacherCount, attendanceCount, notificationCount] = await Promise.all([
      StudentModel.countDocuments({ classId: req.params.id }),
      TeacherModel.countDocuments({ classId: req.params.id }),
      AttendanceModel.countDocuments({ classId: req.params.id }),
      NotificationModel.countDocuments({ classId: req.params.id })
    ]);

    const blockers = [
      studentCount > 0 ? `${studentCount} student(s)` : null,
      teacherCount > 0 ? `${teacherCount} teacher(s)` : null,
      attendanceCount > 0 ? `${attendanceCount} attendance record(s)` : null,
      notificationCount > 0 ? `${notificationCount} notification(s)` : null
    ].filter(Boolean);

    if (blockers.length > 0) {
      return res.status(409).json({
        message: `Cannot delete class: ${blockers.join(", ")} still reference it.`
      });
    }

    trackMutationAudit(res, "MASTER_CLASS_DELETE", "master-data/classes", { classId: req.params.id });
    await ClassModel.findByIdAndDelete(req.params.id);
    return res.status(204).send();
  })
);

masterDataRouter.get(
  "/teachers",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const listQuery = readListQuery(req.query as Record<string, unknown>);
    const filter: Record<string, unknown> = {};

    if (req.auth?.activeRole === "teacher") {
      filter.userId = new mongoose.Types.ObjectId(req.auth.userId);
    }

    if (listQuery.searchRegex) {
      filter.$or = [{ fullName: listQuery.searchRegex }, { phoneNumber: listQuery.searchRegex }];
    }

    return respondWithList(res, TeacherModel as unknown as ListModel, filter, { fullName: 1 }, listQuery);
  })
);

masterDataRouter.post(
  "/teachers",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = CreateTeacherSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid teacher payload", errors: parsed.error.flatten() });
    }

    const classRefError = await referenceError(ClassModel, parsed.data.classId, "classId");
    if (classRefError) {
      return res.status(400).json({ message: classRefError });
    }
    const userRefError = await referenceError(UserModel, parsed.data.userId, "userId");
    if (userRefError) {
      return res.status(400).json({ message: userRefError });
    }

    // When no login is supplied, provision one atomically so the teacher can actually
    // sign in; the one-time temporary PIN is returned to the admin (Deep-H01).
    let userId = parsed.data.userId ? new mongoose.Types.ObjectId(parsed.data.userId) : undefined;
    let credentials: { username: string; temporaryPin: string } | undefined;
    if (!userId) {
      const username = await generateUniqueUsername(parsed.data.fullName);
      const temporaryPin = String(crypto.randomInt(1000, 10000));
      const user = await UserModel.create({
        fullName: parsed.data.fullName,
        username,
        passwordHash: await hashPassword(temporaryPin),
        roles: ["teacher"],
        mustChangePassword: true,
        isActive: parsed.data.isActive ?? true
      });
      userId = user._id;
      credentials = { username, temporaryPin };
    }

    let item;
    try {
      item = await TeacherModel.create({
        ...parsed.data,
        userId,
        classId: parsed.data.classId ? new mongoose.Types.ObjectId(parsed.data.classId) : undefined
      });
    } catch (error) {
      if (credentials) {
        await UserModel.findByIdAndDelete(userId);
      }
      throw error;
    }

    trackMutationAudit(res, "MASTER_TEACHER_CREATE", "master-data/teachers", { teacherId: item.id });
    return res.status(201).json({ item, credentials });
  })
);

masterDataRouter.patch(
  "/teachers/:id",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = CreateTeacherSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid teacher update payload", errors: parsed.error.flatten() });
    }

    const classRefError = await referenceError(ClassModel, parsed.data.classId, "classId");
    if (classRefError) {
      return res.status(400).json({ message: classRefError });
    }
    const userRefError = await referenceError(UserModel, parsed.data.userId || undefined, "userId");
    if (userRefError) {
      return res.status(400).json({ message: userRefError });
    }

    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.userId !== undefined) {
      update.userId = parsed.data.userId ? new mongoose.Types.ObjectId(parsed.data.userId) : undefined;
    }
    if (parsed.data.classId === null) {
      delete update.classId;
      update.$unset = { classId: 1 };
    } else if (parsed.data.classId !== undefined) {
      update.classId = new mongoose.Types.ObjectId(parsed.data.classId);
    }

    const item = await TeacherModel.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!item) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    trackMutationAudit(res, "MASTER_TEACHER_UPDATE", "master-data/teachers", { teacherId: item.id });

    return res.status(200).json({ item });
  })
);

masterDataRouter.delete(
  "/teachers/:id",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    trackMutationAudit(res, "MASTER_TEACHER_DELETE", "master-data/teachers", { teacherId: req.params.id });
    await TeacherModel.findByIdAndDelete(req.params.id);
    return res.status(204).send();
  })
);

masterDataRouter.post(
  "/teachers/:id/reset-pin",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = ResetPinSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid PIN payload", errors: parsed.error.flatten() });
    }

    const teacher = await TeacherModel.findById(req.params.id);
    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }
    if (!teacher.userId) {
      return res.status(409).json({ message: "This teacher has no login account yet" });
    }

    const user = await UserModel.findById(teacher.userId);
    if (!user) {
      return res.status(404).json({ message: "Linked login account not found" });
    }

    user.passwordHash = await hashPassword(parsed.data.newPin);
    user.mustChangePassword = true;
    await user.save();

    // Force a fresh sign-in everywhere so an old session cannot outlive the reset.
    await DeviceSessionModel.updateMany({ userId: user._id }, { $set: { isRevoked: true } });

    trackMutationAudit(res, "MASTER_TEACHER_RESET_PIN", "master-data/teachers", {
      teacherId: teacher.id,
      username: user.username
    });

    return res.status(200).json({ message: "PIN reset", username: user.username });
  })
);

masterDataRouter.get(
  "/students",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (req, res) => {
    const listQuery = readListQuery(req.query as Record<string, unknown>);
    const filter: Record<string, unknown> = {};

    if (req.auth?.activeRole === "teacher") {
      // A teacher only ever sees their own roster, whatever classId they ask for.
      filter.classId = (await resolveTeacherClassId(req.auth.userId)) ?? MATCH_NOTHING;
    } else if (typeof req.query.classId === "string" && mongoose.isValidObjectId(req.query.classId)) {
      filter.classId = new mongoose.Types.ObjectId(req.query.classId);
    }

    if (typeof req.query.status === "string" && req.query.status) {
      filter.status = req.query.status;
    }

    if (listQuery.searchRegex) {
      filter.$or = [
        { fullName: listQuery.searchRegex },
        { regNo: listQuery.searchRegex },
        { rollNumber: listQuery.searchRegex }
      ];
    }

    // numericOrdering sorts "2" before "10" so the roster matches the physical register.
    if (!listQuery.paginated) {
      const items = await StudentModel.find(filter)
        .sort({ rollNumber: 1, fullName: 1 })
        .collation({ locale: "en_US", numericOrdering: true });
      return res.status(200).json({ items, total: items.length, page: 1, pageSize: items.length, totalPages: 1 });
    }

    const [items, total] = await Promise.all([
      StudentModel.find(filter)
        .sort({ rollNumber: 1, fullName: 1 })
        .collation({ locale: "en_US", numericOrdering: true })
        .skip((listQuery.page - 1) * listQuery.pageSize)
        .limit(listQuery.pageSize),
      StudentModel.countDocuments(filter)
    ]);

    return res.status(200).json({
      items,
      total,
      page: listQuery.page,
      pageSize: listQuery.pageSize,
      totalPages: Math.max(1, Math.ceil(total / listQuery.pageSize))
    });
  })
);

masterDataRouter.post(
  "/students",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = CreateStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid student payload", errors: parsed.error.flatten() });
    }

    const classRefError = await referenceError(ClassModel, parsed.data.classId, "classId");
    if (classRefError) {
      return res.status(400).json({ message: classRefError });
    }

    if (invalidDob(parsed.data.dob)) {
      return res.status(400).json({ message: "dob must be a real date between 1950 and today" });
    }

    if (parsed.data.rollNumber) {
      const rollTaken = await StudentModel.exists({
        classId: new mongoose.Types.ObjectId(parsed.data.classId),
        rollNumber: parsed.data.rollNumber,
        status: "active"
      });
      if (rollTaken) {
        return res.status(409).json({ message: "Another active student in this class already has that roll number" });
      }
    }

    const item = await StudentModel.create({
      ...parsed.data,
      classId: new mongoose.Types.ObjectId(parsed.data.classId)
    });

    trackMutationAudit(res, "MASTER_STUDENT_CREATE", "master-data/students", {
      studentId: item.id,
      classId: item.classId.toString()
    });

    return res.status(201).json({ item });
  })
);

masterDataRouter.patch(
  "/students/:id",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = CreateStudentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid student update payload", errors: parsed.error.flatten() });
    }

    const classRefError = await referenceError(ClassModel, parsed.data.classId, "classId");
    if (classRefError) {
      return res.status(400).json({ message: classRefError });
    }

    if (invalidDob(parsed.data.dob)) {
      return res.status(400).json({ message: "dob must be a real date between 1950 and today" });
    }

    const existing = await StudentModel.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Student not found" });
    }

    // Re-check per-class roll uniqueness against the record's effective class/roll/status.
    const effectiveClassId = parsed.data.classId ? new mongoose.Types.ObjectId(parsed.data.classId) : existing.classId;
    const effectiveRoll = parsed.data.rollNumber !== undefined ? parsed.data.rollNumber : existing.rollNumber;
    const effectiveStatus = parsed.data.status ?? existing.status;
    if (effectiveRoll && effectiveStatus === "active") {
      const rollTaken = await StudentModel.exists({
        _id: { $ne: existing._id },
        classId: effectiveClassId,
        rollNumber: effectiveRoll,
        status: "active"
      });
      if (rollTaken) {
        return res.status(409).json({ message: "Another active student in this class already has that roll number" });
      }
    }

    const update: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.classId) {
      update.classId = new mongoose.Types.ObjectId(parsed.data.classId);
    }

    const item = await StudentModel.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!item) {
      return res.status(404).json({ message: "Student not found" });
    }

    trackMutationAudit(res, "MASTER_STUDENT_UPDATE", "master-data/students", { studentId: item.id });

    return res.status(200).json({ item });
  })
);

masterDataRouter.delete(
  "/students/:id",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    trackMutationAudit(res, "MASTER_STUDENT_DELETE", "master-data/students", { studentId: req.params.id });
    await StudentModel.findByIdAndDelete(req.params.id);
    return res.status(204).send();
  })
);

masterDataRouter.get(
  "/attendance-lock",
  requireRoles(["admin", "teacher"]),
  asyncHandler(async (_req, res) => {
    const settings = await AttendanceSettingsModel.findOne();
    return res.status(200).json({ attendanceLockMinutes: settings?.attendanceLockMinutes ?? 60 });
  })
);

masterDataRouter.put(
  "/attendance-lock",
  requireRoles(["admin"]),
  asyncHandler(async (req, res) => {
    const parsed = UpdateLockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid lock settings payload", errors: parsed.error.flatten() });
    }

    const settings = await AttendanceSettingsModel.findOneAndUpdate(
      {},
      { $set: { attendanceLockMinutes: parsed.data.attendanceLockMinutes } },
      { upsert: true, new: true }
    );

    trackMutationAudit(res, "MASTER_ATTENDANCE_LOCK_UPDATE", "master-data/attendance-lock", {
      attendanceLockMinutes: settings.attendanceLockMinutes
    });

    return res.status(200).json({ attendanceLockMinutes: settings.attendanceLockMinutes });
  })
);
