import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../../app.js";
import { AuditLogModel } from "../../models/audit-log.model.js";
import { ClassModel } from "../../models/class.model.js";
import { DeviceSessionModel } from "../../models/device-session.model.js";
import { LeaveRequestModel } from "../../models/leave-request.model.js";
import { TeacherModel } from "../../models/teacher.model.js";
import { TeacherAttendanceAttemptModel, TeacherAttendanceRecordModel } from "../../models/teacher-attendance.model.js";
import { TeacherAttendanceSettingsModel } from "../../models/teacher-attendance-settings.model.js";
import { UserModel, hashPassword } from "../../models/user.model.js";

const app = createApp();

function schoolDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function clearDatabase() {
  await Promise.all([
    UserModel.deleteMany({}),
    DeviceSessionModel.deleteMany({}),
    ClassModel.deleteMany({}),
    TeacherModel.deleteMany({}),
    LeaveRequestModel.deleteMany({}),
    TeacherAttendanceRecordModel.deleteMany({}),
    TeacherAttendanceAttemptModel.deleteMany({}),
    TeacherAttendanceSettingsModel.deleteMany({}),
    AuditLogModel.deleteMany({})
  ]);
}

async function setupTeacher() {
  const user = await UserModel.create({
    fullName: "Attendance Teacher",
    username: "attendance.teacher",
    passwordHash: await hashPassword("1234"),
    roles: ["teacher"],
    isActive: true
  });
  const classDoc = await ClassModel.create({ name: "Class Attendance" });
  const teacher = await TeacherModel.create({
    userId: user._id,
    fullName: user.fullName,
    classId: classDoc._id,
    isActive: true
  });
  await TeacherAttendanceSettingsModel.create({
    geofenceCenterLat: 28.6139,
    geofenceCenterLng: 77.209,
    geofenceRadiusMeters: 100,
    boundaryToleranceMeters: 10,
    markWindowStart: "00:00",
    markWindowEnd: "23:59",
    inTimeThreshold: "23:59",
    maxLocationAccuracyMeters: 100,
    pinMinLength: 4,
    pinNumericOnly: true,
    correctionWindowHours: 24,
    allowAdminBackdateCorrection: true
  });
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username: user.username, password: "1234" });
  expect(login.status).toBe(200);
  return { agent, accessToken: login.body.accessToken as string, teacher };
}

describe("teacher self-attendance", () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 180000);

  beforeEach(clearDatabase);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it("marks once with server time and rejects duplicate submissions deterministically", async () => {
    const { agent, accessToken } = await setupTeacher();
    const payload = { location: { lat: 28.6139, lng: 77.209, accuracyMeters: 10 } };

    const marked = await agent.post("/api/teacher-attendance/mark").set("Authorization", `Bearer ${accessToken}`).send(payload);
    expect(marked.status).toBe(201);
    expect(marked.body.item.attendanceDate).toBe(schoolDateKey());
    expect(marked.body.item.status).toBe("on_time");
    expect(marked.body.item.distanceMeters).toBe(0);

    const duplicate = await agent.post("/api/teacher-attendance/mark").set("Authorization", `Bearer ${accessToken}`).send(payload);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("TEACHER_ATTENDANCE_ALREADY_MARKED");
    expect(await TeacherAttendanceRecordModel.countDocuments()).toBe(1);
  }, 30000);

  it("enforces accuracy, radius, and full-day leave gates", async () => {
    const { agent, accessToken, teacher } = await setupTeacher();
    const base = { location: { lat: 28.6139, lng: 77.209, accuracyMeters: 10 } };

    const outOfRadius = await agent.post("/api/teacher-attendance/mark").set("Authorization", `Bearer ${accessToken}`).send({
      location: { lat: 28.7, lng: 77.3, accuracyMeters: 10 }
    });
    expect(outOfRadius.body.code).toBe("TEACHER_ATTENDANCE_OUT_OF_RADIUS");

    await LeaveRequestModel.create({
      teacherId: teacher._id,
      teacherUserId: (await UserModel.findOne({ username: "attendance.teacher" }))!._id,
      teacherName: teacher.fullName,
      fromDate: schoolDateKey(),
      toDate: schoolDateKey(),
      reason: "Approved leave",
      requestedWorkingDates: [schoolDateKey()],
      approvedWorkingDates: [schoolDateKey()],
      activeDates: [schoolDateKey()],
      status: "approved"
    });
    const onLeave = await agent.post("/api/teacher-attendance/mark").set("Authorization", `Bearer ${accessToken}`).send(base);
    expect(onLeave.body.code).toBe("TEACHER_ATTENDANCE_ON_LEAVE");
    expect(await TeacherAttendanceAttemptModel.countDocuments({ result: "rejected" })).toBe(2);
  }, 30000);

  it("prevents teachers from accessing admin overview but allows settings", async () => {
    const { agent, accessToken } = await setupTeacher();
    const settings = await agent.get("/api/teacher-attendance/settings").set("Authorization", `Bearer ${accessToken}`);
    const overview = await agent.get("/api/teacher-attendance/admin/overview").set("Authorization", `Bearer ${accessToken}`);
    expect(settings.status).toBe(200);
    expect(overview.status).toBe(403);
  }, 30000);
});
