import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { AttendanceModel } from "../../models/attendance.model.js";
import { ClassModel } from "../../models/class.model.js";
import { StudentModel } from "../../models/student.model.js";
import { TeacherModel } from "../../models/teacher.model.js";
import { UserModel, hashPassword } from "../../models/user.model.js";
import { DeviceSessionModel } from "../../models/device-session.model.js";
import { AuditLogModel } from "../../models/audit-log.model.js";
import { MongoMemoryServer } from "mongodb-memory-server";

const app = createApp();

async function clearDatabase() {
  await Promise.all([
    UserModel.deleteMany({}),
    DeviceSessionModel.deleteMany({}),
    ClassModel.deleteMany({}),
    StudentModel.deleteMany({}),
    TeacherModel.deleteMany({}),
    AttendanceModel.deleteMany({}),
    AuditLogModel.deleteMany({})
  ]);
}

describe("auth and reporting integration", () => {
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

  it("supports login, me, role switch and refresh flow", async () => {
    const passwordHash = await hashPassword("Password@123");
    await UserModel.create({
      fullName: "Multi Role User",
      username: "multi.user",
      passwordHash,
      roles: ["teacher", "admin"],
      isActive: true
    });

    const agent = request.agent(app);

    const login = await agent.post("/api/auth/login").send({
      username: "multi.user",
      password: "Password@123",
      activeRole: "teacher"
    });

    expect(login.status).toBe(200);
    expect(login.body.user.activeRole).toBe("teacher");
    expect(typeof login.body.accessToken).toBe("string");

    const me = await agent.get("/api/auth/me").set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe("multi.user");

    const switched = await agent
      .post("/api/auth/switch-role")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .send({ activeRole: "admin" });

    expect(switched.status).toBe(200);
    expect(switched.body.user.activeRole).toBe("admin");

    const refreshed = await agent.post("/api/auth/refresh").send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.user.activeRole).toBe("admin");

    const logout = await agent.post("/api/auth/logout").send({});
    expect(logout.status).toBe(200);
  });

  it("blocks temporary credentials from application data until the PIN changes", async () => {
    await UserModel.create({
      fullName: "Temporary Teacher",
      username: "temporary.teacher",
      passwordHash: await hashPassword("1234"),
      roles: ["teacher"],
      mustChangePassword: true,
      isActive: true
    });

    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({
      username: "temporary.teacher",
      password: "1234"
    });

    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    const accessToken = login.body.accessToken as string;

    const blocked = await agent
      .get("/api/master-data/classes")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const changed = await agent
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ currentPassword: "1234", newPassword: "5678" });
    expect(changed.status).toBe(200);

    const allowed = await agent
      .get("/api/master-data/classes")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(allowed.status).toBe(200);
  });

  it("scopes reporting for teachers and supports CSV export", async () => {
    const admin = await UserModel.create({
      fullName: "Admin User",
      username: "admin.reporting",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });

    const teacherUser = await UserModel.create({
      fullName: "Teacher User",
      username: "teacher.reporting",
      passwordHash: await hashPassword("Teacher@12345"),
      roles: ["teacher"],
      isActive: true
    });

    const classA = await ClassModel.create({ name: "Class 7" });
    const classB = await ClassModel.create({ name: "Class 8" });

    const studentA1 = await StudentModel.create({
      regNo: "REG-A1",
      fullName: "Student A1",
      classId: classA._id,
      rollNumber: "1",
      status: "active"
    });

    const studentA2 = await StudentModel.create({
      regNo: "REG-A2",
      fullName: "Student A2",
      classId: classA._id,
      rollNumber: "2",
      status: "active"
    });

    const studentB1 = await StudentModel.create({
      regNo: "REG-B1",
      fullName: "Student B1",
      classId: classB._id,
      rollNumber: "1",
      status: "active"
    });

    await TeacherModel.create({
      userId: teacherUser._id,
      fullName: "Teacher User",
      classId: classA._id,
      isActive: true
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await AttendanceModel.create({
      classId: classA._id,
      attendanceDate: today,
      entries: [
        { studentId: studentA1._id, status: "present" },
        { studentId: studentA2._id, status: "absent" },
        { studentId: new mongoose.Types.ObjectId(), status: "absent" }
      ],
      submittedBy: admin._id,
      lastUpdatedBy: admin._id,
      lockedAt: new Date(today.getTime() + 60 * 60 * 1000)
    });

    await AttendanceModel.create({
      classId: classB._id,
      attendanceDate: today,
      entries: [{ studentId: studentB1._id, status: "absent" }],
      submittedBy: admin._id,
      lastUpdatedBy: admin._id,
      lockedAt: new Date(today.getTime() + 60 * 60 * 1000)
    });

    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({
      username: "teacher.reporting",
      password: "Teacher@12345"
    });

    expect(login.status).toBe(200);

    const accessToken = login.body.accessToken as string;

    const overview = await agent
      .get("/api/reports/overview?days=30")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(overview.status).toBe(200);
    expect(overview.body.totals.students).toBe(2);
    expect(overview.body.totals.classes).toBe(1);
    expect(overview.body.absenceInsights.byClass).toEqual([
      expect.objectContaining({
        className: "Class 7",
        students: [expect.objectContaining({ studentName: "Student A2", absenceCount: 1 })]
      })
    ]);
    expect(JSON.stringify(overview.body.absenceInsights)).not.toContain("Unknown");
    expect(overview.body.absenceInsights).not.toHaveProperty("schoolTop");

    const deniedClassQuery = await agent
      .get(`/api/reports/overview?days=30&classId=${classB.id}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(deniedClassQuery.status).toBe(403);

    const adminAgent = request.agent(app);
    const adminLogin = await adminAgent.post("/api/auth/login").send({
      username: "admin.reporting",
      password: "Admin@12345"
    });
    const adminOverview = await adminAgent
      .get(`/api/reports/overview?days=30&classId=${classA.id}`)
      .set("Authorization", `Bearer ${adminLogin.body.accessToken as string}`);

    expect(adminOverview.status).toBe(200);
    expect(adminOverview.body.absenceInsights.byClass).toHaveLength(1);
    expect(adminOverview.body.absenceInsights.byClass[0].className).toBe("Class 7");
    expect(adminOverview.body.absenceInsights.schoolTop).toEqual([
      expect.objectContaining({ studentName: "Student A2", className: "Class 7", absenceCount: 1 }),
      expect.objectContaining({ studentName: "Student B1", className: "Class 8", absenceCount: 1 })
    ]);

    const csvExport = await agent
      .get("/api/reports/export?format=csv")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(csvExport.status).toBe(200);
    expect(csvExport.header["content-type"]).toContain("text/csv");
    expect(csvExport.text).toContain("date,class,session,totalMarked,presentLike,rate");
  });
});
