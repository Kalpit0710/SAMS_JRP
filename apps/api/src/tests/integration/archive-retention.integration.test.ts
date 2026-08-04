import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { AttendanceModel } from "../../models/attendance.model.js";
import { AttendanceSettingsModel } from "../../models/attendance-settings.model.js";
import { ClassModel } from "../../models/class.model.js";
import { StudentAcademicYearArchiveModel } from "../../models/student-academic-year-archive.model.js";
import { StudentModel } from "../../models/student.model.js";
import { UserModel, hashPassword } from "../../models/user.model.js";
import { MongoMemoryServer } from "mongodb-memory-server";

const app = createApp();

async function clearDatabase() {
  await Promise.all([
    UserModel.deleteMany({}),
    ClassModel.deleteMany({}),
    StudentModel.deleteMany({}),
    AttendanceModel.deleteMany({}),
    AttendanceSettingsModel.deleteMany({}),
    StudentAcademicYearArchiveModel.deleteMany({})
  ]);
}

async function loginAs(username: string, password: string) {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username, password });
  expect(login.status).toBe(200);
  return { agent, accessToken: login.body.accessToken as string };
}

describe("academic-year archive flow", () => {
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

  it("preview and finalize a completed academic year into student archives", async () => {
    await UserModel.create({
      fullName: "Archive Admin",
      username: "archive.admin",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });

    await AttendanceSettingsModel.create({
      academicYearStartMonth: 4,
      academicYearStartDay: 1
    });

    const classDoc = await ClassModel.create({ name: "Archive Class" });
    const firstStudent = await StudentModel.create({
      regNo: "A-001",
      fullName: "Asha",
      classId: classDoc._id,
      status: "active"
    });
    const secondStudent = await StudentModel.create({
      regNo: "A-002",
      fullName: "Bharat",
      classId: classDoc._id,
      status: "active"
    });

    await AttendanceModel.create({
      classId: classDoc._id,
      attendanceDate: new Date("2024-04-15T00:00:00.000Z"),
      entries: [
        { studentId: firstStudent._id, status: "present" },
        { studentId: secondStudent._id, status: "absent" }
      ],
      submittedBy: new mongoose.Types.ObjectId(),
      lastUpdatedBy: new mongoose.Types.ObjectId(),
      lockedAt: new Date("2024-04-15T23:59:59.000Z")
    });

    const { agent, accessToken } = await loginAs("archive.admin", "Admin@12345");

    const preview = await agent
      .get("/api/master-data/attendance-archive/preview")
      .query({ academicYear: "2024-2025" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(preview.status).toBe(200);
    expect(preview.body.academicYear).toBe("2024-2025");
    expect(preview.body.studentCount).toBe(2);
    expect(preview.body.attendanceCount).toBe(1);

    const finalize = await agent
      .post("/api/master-data/attendance-archive/finalize")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ academicYear: "2024-2025" });

    expect(finalize.status).toBe(201);
    expect(finalize.body.createdArchives).toBe(2);
    expect(finalize.body.deletedAttendanceCount).toBe(1);

    const archivedDocs = await StudentAcademicYearArchiveModel.find({ academicYear: "2024-2025" }).sort("studentId");
    expect(archivedDocs).toHaveLength(2);
    expect(archivedDocs[0].totals.presentLikeDays).toBe(1);
    expect(archivedDocs[0].totals.present).toBe(1);
    expect(archivedDocs[1].totals.presentLikeDays).toBe(0);
    expect(archivedDocs[1].totals.absent).toBe(1);

    const rawAttendance = await AttendanceModel.find({});
    expect(rawAttendance).toHaveLength(0);
  });

  it("lists archived records and blocks writes for finalized academic years", async () => {
    const admin = await UserModel.create({
      fullName: "Archive Admin",
      username: "archive.admin2",
      passwordHash: await hashPassword("Admin@12345"),
      roles: ["admin"],
      isActive: true
    });

    await AttendanceSettingsModel.create({
      academicYearStartMonth: 4,
      academicYearStartDay: 1
    });

    const classDoc = await ClassModel.create({ name: "Archive Class 2" });
    const student = await StudentModel.create({
      regNo: "A-101",
      fullName: "Chetan",
      classId: classDoc._id,
      status: "active"
    });

    const archive = await StudentAcademicYearArchiveModel.create({
      studentId: student._id,
      classId: classDoc._id,
      academicYear: "2024-2025",
      academicYearStart: new Date("2024-04-01T00:00:00.000Z"),
      academicYearEnd: new Date("2025-03-31T23:59:59.999Z"),
      totals: { presentLikeDays: 1, present: 1, absent: 0, late: 0, halfDay: 0, totalMarkedDays: 1 },
      monthly: [{ month: 4, presentLikeDays: 1, present: 1, absent: 0, late: 0, halfDay: 0, totalMarkedDays: 1 }],
      finalizedBy: admin._id
    });

    const { agent, accessToken } = await loginAs("archive.admin2", "Admin@12345");

    const list = await agent
      .get("/api/master-data/attendance-archive/records")
      .query({ academicYear: "2024-2025" })
      .set("Authorization", `Bearer ${accessToken}`);

    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]._id).toBe(archive._id.toString());
    expect(list.body.items[0].student.fullName).toBe("Chetan");

    const blockedSubmit = await agent
      .post("/api/attendance/submit")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        classId: classDoc._id.toString(),
        attendanceDate: "2024-04-20",
        entries: [{ studentId: student._id.toString(), status: "present" }]
      });

    expect(blockedSubmit.status).toBe(409);
    expect(blockedSubmit.body.message).toContain("finalized");
  });
});
