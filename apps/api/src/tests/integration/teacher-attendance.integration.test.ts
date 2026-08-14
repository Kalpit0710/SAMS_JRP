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
import { TeacherAttendanceRequestModel } from "../../models/teacher-attendance-request.model.js";
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

function pastDateKey(offset: number) {
  const [year, month, day] = schoolDateKey().split("-").map(Number);
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() - offset);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("-");
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
    TeacherAttendanceRequestModel.deleteMany({}),
    TeacherAttendanceSettingsModel.deleteMany({}),
    AuditLogModel.deleteMany({})
  ]);
}

async function loginAs(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return { agent, accessToken: login.body.accessToken as string };
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

  it("lets a teacher apply for a manual attendance request and an admin approve it into a real record", async () => {
    const { agent, accessToken, teacher } = await setupTeacher();
    await UserModel.create({
      fullName: "Attendance Admin",
      username: "attendance.admin",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });
    const { agent: adminAgent, accessToken: adminToken } = await loginAs("attendance.admin", "Admin@12345");
    const missedDate = pastDateKey(1);

    const created = await agent
      .post("/api/teacher-attendance/requests")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ attendanceDate: missedDate, requestType: "manual", requestedStatus: "on_time", reason: "Forgot to check in" });
    expect(created.status).toBe(201);
    expect(created.body.item.status).toBe("pending");

    const duplicate = await agent
      .post("/api/teacher-attendance/requests")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ attendanceDate: missedDate, requestType: "manual", requestedStatus: "late", reason: "Second attempt" });
    expect(duplicate.status).toBe(409);

    const teacherView = await agent.get("/api/teacher-attendance/requests/me").set("Authorization", `Bearer ${accessToken}`);
    expect(teacherView.body.items).toHaveLength(1);

    const pending = await adminAgent.get("/api/teacher-attendance/admin/requests?status=pending").set("Authorization", `Bearer ${adminToken}`);
    expect(pending.body.items).toHaveLength(1);
    const requestId = pending.body.items[0]._id as string;

    const reviewed = await adminAgent
      .patch(`/api/teacher-attendance/admin/requests/${requestId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "approved" });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.item.status).toBe("approved");
    expect(reviewed.body.record.status).toBe("on_time");
    expect(reviewed.body.record.source).toBe("manual_application");

    const record = await TeacherAttendanceRecordModel.findOne({ teacherId: teacher._id, attendanceDate: missedDate });
    expect(record).not.toBeNull();
    expect(record!.status).toBe("on_time");
  }, 30000);

  it("lets a teacher apply for a correction request and an admin reject it without changing the record", async () => {
    const { agent, accessToken, teacher } = await setupTeacher();
    await UserModel.create({
      fullName: "Attendance Admin",
      username: "attendance.admin",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });
    const { agent: adminAgent, accessToken: adminToken } = await loginAs("attendance.admin", "Admin@12345");

    const marked = await agent
      .post("/api/teacher-attendance/mark")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ location: { lat: 28.6139, lng: 77.209, accuracyMeters: 10 } });
    expect(marked.status).toBe(201);

    const noExistingRecord = await agent
      .post("/api/teacher-attendance/requests")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ attendanceDate: pastDateKey(2), requestType: "correction", requestedStatus: "on_time", reason: "No record exists" });
    expect(noExistingRecord.status).toBe(409);

    const created = await agent
      .post("/api/teacher-attendance/requests")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ attendanceDate: schoolDateKey(), requestType: "correction", requestedStatus: "on_time", reason: "GPS was wrong" });
    expect(created.status).toBe(201);
    const requestId = created.body.item._id as string;

    const reviewed = await adminAgent
      .patch(`/api/teacher-attendance/admin/requests/${requestId}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "rejected", decisionNote: "Distance log shows accurate GPS" });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.item.status).toBe("rejected");
    expect(reviewed.body.item.decisionNote).toBe("Distance log shows accurate GPS");

    const record = await TeacherAttendanceRecordModel.findOne({ teacherId: teacher._id, attendanceDate: schoolDateKey() });
    expect(record!.status).toBe("on_time");
    expect(record!.source).toBe("self");
  }, 30000);
});
