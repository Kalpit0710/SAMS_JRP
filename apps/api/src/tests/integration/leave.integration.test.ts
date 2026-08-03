import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../../app.js";
import { AuditLogModel } from "../../models/audit-log.model.js";
import { ClassModel } from "../../models/class.model.js";
import { DeviceSessionModel } from "../../models/device-session.model.js";
import { LeaveRequestModel } from "../../models/leave-request.model.js";
import { LeaveSettingsModel } from "../../models/leave-settings.model.js";
import { TeacherModel } from "../../models/teacher.model.js";
import { UserModel, hashPassword } from "../../models/user.model.js";

const app = createApp();

function futureDateKey(offset: number) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("-");
}

function displayDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

async function clearDatabase() {
  await Promise.all([
    UserModel.deleteMany({}),
    DeviceSessionModel.deleteMany({}),
    ClassModel.deleteMany({}),
    TeacherModel.deleteMany({}),
    LeaveRequestModel.deleteMany({}),
    LeaveSettingsModel.deleteMany({}),
    AuditLogModel.deleteMany({})
  ]);
}

async function loginAs(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return { agent, accessToken: login.body.accessToken as string };
}

describe("teacher leave management", () => {
  let mongoServer: MongoMemoryServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 180000);

  beforeEach(async () => {
    await clearDatabase();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  it("snapshots working dates, partially approves, and reports approved days", async () => {
    await UserModel.create({
      fullName: "Leave Admin",
      username: "leave.admin",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });
    const teacherUser = await UserModel.create({
      fullName: "Leave Teacher",
      username: "leave.teacher",
      passwordHash: await hashPassword("Teacher@12345"),
      roles: ["teacher"],
      isActive: true
    });
    const classDoc = await ClassModel.create({ name: "Class Leave" });
    const teacher = await TeacherModel.create({
      userId: teacherUser._id,
      fullName: "Leave Teacher",
      classId: classDoc._id,
      phoneNumber: "9876543210",
      isActive: true
    });
    const fromDate = futureDateKey(10);
    const holidayDate = futureDateKey(11);
    const toDate = futureDateKey(12);
    const { agent: adminAgent, accessToken: adminToken } = await loginAs("leave.admin", "Admin@12345");
    const settings = await adminAgent
      .put("/api/leaves/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        adminWhatsAppNumber: "9000000001",
        nonWorkingWeekdays: [],
        holidays: [{ date: holidayDate, name: "School Holiday" }]
      });
    expect(settings.status).toBe(200);

    const { agent: teacherAgent, accessToken: teacherToken } = await loginAs("leave.teacher", "Teacher@12345");
    const created = await teacherAgent
      .post("/api/leaves")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ fromDate, toDate, reason: "Family commitment" });

    expect(created.status).toBe(201);
    expect(created.body.item.requestedWorkingDates).toEqual([fromDate, toDate]);
    expect(created.body.item.requestedWorkingDays).toBe(2);
    expect(created.body.item.adminWhatsAppLink).toContain("https://wa.me/919000000001");
    const adminMessage = new URL(created.body.item.adminWhatsAppLink).searchParams.get("text") ?? "";
    expect(adminMessage).toContain(`${displayDate(fromDate)} to ${displayDate(toDate)}`);
    expect(adminMessage).toContain(`/leaves?request=${created.body.item._id}`);

    const duplicate = await teacherAgent
      .post("/api/leaves")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ fromDate, toDate, reason: "Overlapping request" });
    expect(duplicate.status).toBe(409);

    const decided = await adminAgent
      .post(`/api/leaves/${created.body.item._id}/decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "partially_approve", approvedFromDate: fromDate, approvedToDate: fromDate });
    expect(decided.status).toBe(200);
    expect(decided.body.item.status).toBe("partially_approved");
    expect(decided.body.item.approvedWorkingDays).toBe(1);
    const teacherMessage = new URL(decided.body.item.teacherWhatsAppLink).searchParams.get("text") ?? "";
    expect(teacherMessage).toContain(`Approved dates: ${displayDate(fromDate)} to ${displayDate(fromDate)}`);

    const analytics = await adminAgent
      .get(`/api/leaves/analytics?fromDate=${fromDate}&toDate=${toDate}&teacherId=${teacher.id}&granularity=day`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.summary.approvedLeaveDays).toBe(1);
    expect(analytics.body.summary.partially_approved).toBe(1);
    expect(analytics.body.teachers[0].approvedDays).toBe(1);
    expect(analytics.body.trend).toEqual([{ period: fromDate, leaveDays: 1 }]);
  });

  it("scopes teacher detail access and allows pending withdrawal", async () => {
    await UserModel.create({
      fullName: "Scope Admin",
      username: "scope.admin",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });
    const firstUser = await UserModel.create({
      fullName: "First Teacher",
      username: "first.teacher",
      passwordHash: await hashPassword("Teacher@12345"),
      roles: ["teacher"],
      isActive: true
    });
    const secondUser = await UserModel.create({
      fullName: "Second Teacher",
      username: "second.teacher",
      passwordHash: await hashPassword("Teacher@12345"),
      roles: ["teacher"],
      isActive: true
    });
    const classDoc = await ClassModel.create({ name: "Class Scope" });
    await TeacherModel.create({ userId: firstUser._id, fullName: "First Teacher", classId: classDoc._id, isActive: true });
    await TeacherModel.create({ userId: secondUser._id, fullName: "Second Teacher", isActive: true });
    await LeaveSettingsModel.create({ nonWorkingWeekdays: [], holidays: [] });
    const fromDate = futureDateKey(20);
    const { agent: firstAgent, accessToken: firstToken } = await loginAs("first.teacher", "Teacher@12345");
    const created = await firstAgent
      .post("/api/leaves")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ fromDate, toDate: fromDate, reason: "Personal work" });
    expect(created.status).toBe(201);
    expect(created.body.item.hasAdminWhatsAppNumber).toBe(false);
    expect(created.body.item.adminWhatsAppLink).toContain("https://wa.me/?text=");

    const { agent: secondAgent, accessToken: secondToken } = await loginAs("second.teacher", "Teacher@12345");
    const hidden = await secondAgent
      .get(`/api/leaves/${created.body.item._id}`)
      .set("Authorization", `Bearer ${secondToken}`);
    expect(hidden.status).toBe(404);

    const { agent: adminAgent, accessToken: adminToken } = await loginAs("scope.admin", "Admin@12345");
    const rejected = await adminAgent
      .post(`/api/leaves/${created.body.item._id}/decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "reject" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.item.hasTeacherWhatsAppNumber).toBe(false);
    expect(rejected.body.item.teacherWhatsAppLink).toContain("https://wa.me/?text=");

    const withdrawDate = futureDateKey(21);
    const pending = await firstAgent
      .post("/api/leaves")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ fromDate: withdrawDate, toDate: withdrawDate, reason: "Withdraw this request" });
    expect(pending.status).toBe(201);

    const withdrawn = await firstAgent
      .post(`/api/leaves/${pending.body.item._id}/withdraw`)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.item.status).toBe("withdrawn");
    expect(withdrawn.body.item.activeDates).toEqual([]);
  });

  it("validates calendar settings, preserves snapshots, and releases rejected dates", async () => {
    await UserModel.create({
      fullName: "Calendar Admin",
      username: "calendar.admin",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });
    const teacherUser = await UserModel.create({
      fullName: "Calendar Teacher",
      username: "calendar.teacher",
      passwordHash: await hashPassword("Teacher@12345"),
      roles: ["teacher"],
      isActive: true
    });
    const classDoc = await ClassModel.create({ name: "Class Calendar" });
    await TeacherModel.create({
      userId: teacherUser._id,
      fullName: "Calendar Teacher",
      classId: classDoc._id,
      phoneNumber: "9888888888",
      isActive: true
    });
    const date = futureDateKey(30);
    const { agent: adminAgent, accessToken: adminToken } = await loginAs("calendar.admin", "Admin@12345");
    const { agent: teacherAgent, accessToken: teacherToken } = await loginAs("calendar.teacher", "Teacher@12345");

    const duplicateHoliday = await adminAgent
      .put("/api/leaves/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        adminWhatsAppNumber: "9000000002",
        nonWorkingWeekdays: [0],
        holidays: [{ date, name: "First" }, { date, name: "Duplicate" }]
      });
    expect(duplicateHoliday.status).toBe(400);

    const closedCalendar = await adminAgent
      .put("/api/leaves/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ adminWhatsAppNumber: "9000000002", nonWorkingWeekdays: [0, 1, 2, 3, 4, 5, 6], holidays: [] });
    expect(closedCalendar.status).toBe(200);

    const privateSettings = await teacherAgent
      .get("/api/leaves/settings")
      .set("Authorization", `Bearer ${teacherToken}`);
    expect(privateSettings.status).toBe(200);
    expect(privateSettings.body.hasAdminWhatsAppNumber).toBe(true);
    expect(privateSettings.body.adminWhatsAppNumber).toBeUndefined();

    const noWorkingDays = await teacherAgent
      .post("/api/leaves")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ fromDate: date, toDate: date, reason: "Calendar closure" });
    expect(noWorkingDays.status).toBe(400);

    await adminAgent
      .put("/api/leaves/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ adminWhatsAppNumber: "9000000002", nonWorkingWeekdays: [], holidays: [] });
    const firstRequest = await teacherAgent
      .post("/api/leaves")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ fromDate: date, toDate: date, reason: "First request" });
    expect(firstRequest.status).toBe(201);
    expect(firstRequest.body.item.requestedWorkingDates).toEqual([date]);

    await adminAgent
      .put("/api/leaves/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ adminWhatsAppNumber: "9000000002", nonWorkingWeekdays: [], holidays: [{ date, name: "Added later" }] });
    const unchanged = await adminAgent
      .get(`/api/leaves/${firstRequest.body.item._id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(unchanged.body.item.requestedWorkingDates).toEqual([date]);

    const rejected = await adminAgent
      .post(`/api/leaves/${firstRequest.body.item._id}/decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "reject" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.item.activeDates).toEqual([]);

    await adminAgent
      .put("/api/leaves/settings")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ adminWhatsAppNumber: "9000000002", nonWorkingWeekdays: [], holidays: [] });
    const secondRequest = await teacherAgent
      .post("/api/leaves")
      .set("Authorization", `Bearer ${teacherToken}`)
      .send({ fromDate: date, toDate: date, reason: "Replacement request" });
    expect(secondRequest.status).toBe(201);

    await expect.poll(() => AuditLogModel.countDocuments({
      action: { $in: ["LEAVE_SETTINGS_UPDATE", "LEAVE_REQUEST_DECIDE"] }
    })).toBeGreaterThanOrEqual(2);
  });
});