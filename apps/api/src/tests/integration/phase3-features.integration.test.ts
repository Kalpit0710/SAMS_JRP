import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { AttendanceModel } from "../../models/attendance.model.js";
import { AuditLogModel } from "../../models/audit-log.model.js";
import { ClassModel } from "../../models/class.model.js";
import { DeviceSessionModel } from "../../models/device-session.model.js";
import { ImportLogModel } from "../../models/import-log.model.js";
import { NotificationModel } from "../../models/notification.model.js";
import { StudentModel } from "../../models/student.model.js";
import { UserModel, hashPassword } from "../../models/user.model.js";
import { MongoMemoryServer } from "mongodb-memory-server";

const app = createApp();

async function clearDatabase() {
  await Promise.all([
    UserModel.deleteMany({}),
    DeviceSessionModel.deleteMany({}),
    ClassModel.deleteMany({}),
    StudentModel.deleteMany({}),
    AttendanceModel.deleteMany({}),
    NotificationModel.deleteMany({}),
    ImportLogModel.deleteMany({}),
    AuditLogModel.deleteMany({})
  ]);
}

async function loginAs(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return { agent, accessToken: login.body.accessToken as string };
}

describe("notifications and data transfer", () => {
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

  it("creates WhatsApp alerts for absentees on attendance submit", async () => {
    await UserModel.create({
      fullName: "Alert Admin",
      username: "alert.admin",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });

    const classDoc = await ClassModel.create({ name: "Class 6" });

    const absentee = await StudentModel.create({
      regNo: "REG-N1",
      fullName: "Absent Child",
      classId: classDoc._id,
      fatherName: "Parent One",
      phoneNumber: "9876543210",
      status: "active"
    });
    const attendee = await StudentModel.create({
      regNo: "REG-N2",
      fullName: "Present Child",
      classId: classDoc._id,
      status: "active"
    });

    const { agent, accessToken } = await loginAs("alert.admin", "Admin@12345");
    const attendanceDate = new Date().toISOString().slice(0, 10);

    const submit = await agent
      .post("/api/attendance/submit")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        classId: String(classDoc._id),
        attendanceDate,
        entries: [
          { studentId: String(absentee._id), status: "absent" },
          { studentId: String(attendee._id), status: "present" }
        ]
      });

    expect(submit.status).toBe(201);
    expect(submit.body.notifications.created).toBe(1);

    const list = await agent
      .get(`/api/notifications?date=${attendanceDate}&state=pending`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);

    const alert = list.body.items[0];
    expect(alert.studentName).toBe("Absent Child");
    expect(alert.waLink.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(alert.waLinkEn.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    const message = new URL(alert.waLink).searchParams.get("text") ?? "";
    expect(message).toContain("Absent Child (Class 6) was absent");
    expect(message).toContain("जे. आर. प्रिपरेटरी स्कूल से उपस्थिति सूचना");
    expect(message).toContain("Absent Child (Class 6)");
    expect(message).not.toContain("*English*");
    expect(message).not.toContain("*हिंदी*");
    expect(message.indexOf("Attendance update")).toBeLessThan(message.indexOf("उपस्थिति सूचना"));

    const marked = await agent
      .patch(`/api/notifications/${alert._id}/state`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ state: "sent" });

    expect(marked.status).toBe(200);
    expect(marked.body.item.state).toBe("sent");

    const summary = await agent
      .get(`/api/notifications/summary?date=${attendanceDate}`)
      .set("Authorization", `Bearer ${accessToken}`);

    expect(summary.body.summary.sent).toBe(1);
    expect(summary.body.summary.pending).toBe(0);
  });

  it("validates, imports and exports students via CSV", async () => {
    await UserModel.create({
      fullName: "Data Admin",
      username: "data.admin",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });

    await ClassModel.create({ name: "Class 5" });

    const { agent, accessToken } = await loginAs("data.admin", "Admin@12345");

    const template = await agent
      .get("/api/data-transfer/template/students")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(template.status).toBe(200);
    expect(template.text).toContain("regNo,fullName");
    expect(template.text).toContain("phoneNumber");

    const header = "regNo,fullName,className,rollNumber,dob,fatherName,motherName,phoneNumber,status";
    const csv = [
      header,
      "24307,Valid Child,Class 5,1,2020-04-08,Mr. Naved Khan,Mrs. Farhana Bee,9000000001,active",
      "24308,Broken Child,No Such Class,2,,,,,active"
    ].join("\n");

    const preview = await agent
      .post("/api/data-transfer/import/students")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ csv, fileName: "students.csv", commit: false });

    expect(preview.status).toBe(200);
    expect(preview.body.validCount).toBe(1);
    expect(preview.body.failedCount).toBe(1);

    const blocked = await agent
      .post("/api/data-transfer/import/students")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ csv, commit: true });

    expect(blocked.status).toBe(422);
    expect(await StudentModel.countDocuments({})).toBe(0);

    const committed = await agent
      .post("/api/data-transfer/import/students")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ csv, fileName: "students.csv", commit: true, skipInvalid: true });

    expect(committed.status).toBe(201);
    expect(committed.body.createdCount).toBe(1);
    expect(await StudentModel.countDocuments({})).toBe(1);

    const saved = await StudentModel.findOne({ regNo: "24307" }).lean();
    expect(saved?.phoneNumber).toBe("9000000001");
    expect(saved?.fatherName).toBe("Mr. Naved Khan");

    const exported = await agent
      .get("/api/data-transfer/export/students")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(exported.status).toBe(200);
    expect(exported.text).toContain("Valid Child");

    const logs = await agent.get("/api/data-transfer/logs").set("Authorization", `Bearer ${accessToken}`);
    expect(logs.body.items[0].createdCount).toBe(1);
  });
});
