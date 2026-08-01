/**
 * Copies the real school data (classes, teachers, students) from the legacy
 * res-try database into this system's database.
 *
 * The source connection is opened READ-ONLY: this script never issues a write
 * against it. Target documents keep their original _id values so class/teacher
 * references stay intact and the import is safely repeatable.
 *
 * Usage:
 *   SOURCE_MONGO_URI="<legacy uri>" npx tsx src/scripts/import-school-data.ts [--wipe]
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDb } from "../lib/db.js";
import { AttendanceModel } from "../models/attendance.model.js";
import { ClassModel } from "../models/class.model.js";
import { DeviceSessionModel } from "../models/device-session.model.js";
import { NotificationModel } from "../models/notification.model.js";
import { StudentModel } from "../models/student.model.js";
import { TeacherModel } from "../models/teacher.model.js";
import { UserModel, hashPassword } from "../models/user.model.js";

type SourceClass = { _id: mongoose.Types.ObjectId; name: string };
type SourceTeacher = { _id: mongoose.Types.ObjectId; name: string; classId?: mongoose.Types.ObjectId; pin?: string };
type SourceStudent = {
  _id: mongoose.Types.ObjectId;
  regNo: string;
  name: string;
  fatherName?: string;
  motherName?: string;
  dob?: Date;
  classId: mongoose.Types.ObjectId;
  rollNo?: string;
};

const sourceUri = process.env.SOURCE_MONGO_URI;
const wipe = process.argv.includes("--wipe");

const DEFAULT_TEACHER_PIN = "1234";

if (!sourceUri) {
  console.error("SOURCE_MONGO_URI is required (the legacy res-try connection string)");
  process.exit(1);
}

/** "Shriya Khandelwal" -> "shriya.khandelwal", de-duplicated with a numeric suffix. */
function toUsername(name: string, taken: Set<string>) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "") || "teacher";

  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}${counter}`;
    counter += 1;
  }

  taken.add(candidate);
  return candidate;
}

/** Indexes from earlier schema versions (admissionNumber, sectionId, class code...) still
 *  exist on the collections and would reject the new documents, so clear them out. */
async function dropStaleIndexes() {
  const models = [ClassModel, StudentModel, TeacherModel, AttendanceModel, NotificationModel];

  for (const model of models) {
    const indexes = await model.collection.indexes().catch(() => []);
    for (const index of indexes) {
      if (index.name && index.name !== "_id_") {
        await model.collection.dropIndex(index.name).catch(() => undefined);
      }
    }
  }
}

async function importSchoolData() {
  const source = await mongoose.createConnection(sourceUri!).asPromise();
  await connectDb(env.MONGODB_URI);

  try {
    const sourceDb = source.db;
    if (!sourceDb) {
      throw new Error("Could not open the source database");
    }

    const [classes, teachers, students] = await Promise.all([
      sourceDb.collection<SourceClass>("classes").find({}).toArray(),
      sourceDb.collection<SourceTeacher>("teachers").find({}).toArray(),
      sourceDb.collection<SourceStudent>("students").find({}).toArray()
    ]);

    console.log(`Source: ${classes.length} classes, ${teachers.length} teachers, ${students.length} students`);

    if (wipe) {
      console.log("Wiping existing target data...");
      await Promise.all([
        AttendanceModel.deleteMany({}),
        NotificationModel.deleteMany({}),
        DeviceSessionModel.deleteMany({}),
        StudentModel.deleteMany({}),
        TeacherModel.deleteMany({}),
        ClassModel.deleteMany({}),
        UserModel.deleteMany({})
      ]);

      console.log("Dropping stale indexes...");
      await dropStaleIndexes();
      await Promise.all([
        ClassModel.syncIndexes(),
        StudentModel.syncIndexes(),
        TeacherModel.syncIndexes(),
        AttendanceModel.syncIndexes(),
        NotificationModel.syncIndexes()
      ]);
    }

    for (const item of classes) {
      await ClassModel.updateOne(
        { _id: item._id },
        { $set: { name: item.name, isActive: true } },
        { upsert: true }
      );
    }
    console.log(`Classes upserted: ${classes.length}`);

    const adminInitialPassword = process.env.ADMIN_INITIAL_PASSWORD;
    if (!adminInitialPassword || adminInitialPassword.length < 12) {
      throw new Error("ADMIN_INITIAL_PASSWORD must be set to at least 12 characters before importing data");
    }
    const adminPasswordHash = await hashPassword(adminInitialPassword);
    await UserModel.updateOne(
      { username: "admin" },
      {
        $set: {
          fullName: "SAMS Administrator",
          username: "admin",
          passwordHash: adminPasswordHash,
          roles: ["admin"],
          mustChangePassword: true,
          isActive: true
        }
      },
      { upsert: true }
    );

    const takenUsernames = new Set<string>(["admin"]);
    // The legacy PINs are one-way hashes nobody knows, so everyone starts on a shared
    // default and is expected to change it from Settings after signing in.
    const teacherPinHash = await hashPassword(DEFAULT_TEACHER_PIN);
    const credentials: Array<{ teacher: string; username: string }> = [];

    for (const item of teachers) {
      const username = toUsername(item.name, takenUsernames);
      const user = await UserModel.findOneAndUpdate(
        { username },
        {
          $set: {
            fullName: item.name,
            username,
            passwordHash: teacherPinHash,
            roles: ["teacher"],
            mustChangePassword: true,
            isActive: true
          }
        },
        { upsert: true, returnDocument: "after" }
      );

      await TeacherModel.updateOne(
        { _id: item._id },
        {
          $set: {
            fullName: item.name,
            classId: item.classId,
            userId: user?._id,
            isActive: true
          }
        },
        { upsert: true }
      );

      credentials.push({ teacher: item.name, username });
    }
    console.log(`Teachers upserted: ${teachers.length}`);

    let studentCount = 0;
    for (const item of students) {
      await StudentModel.updateOne(
        { _id: item._id },
        {
          $set: {
            regNo: item.regNo,
            fullName: item.name,
            classId: item.classId,
            rollNumber: item.rollNo,
            dob: item.dob,
            fatherName: item.fatherName,
            motherName: item.motherName,
            status: "active"
          }
        },
        { upsert: true }
      );
      studentCount += 1;
    }
    console.log(`Students upserted: ${studentCount}`);

    console.log(`\nTeacher logins (PIN = ${DEFAULT_TEACHER_PIN}):`);
    for (const row of credentials) {
      console.log(`  ${row.teacher.padEnd(22)} -> ${row.username}`);
    }
    console.log("\nAdmin login created from ADMIN_INITIAL_PASSWORD.");
    console.log("All users must change their temporary credential after signing in.");
    console.log("Student phone numbers are intentionally empty - fill them in to enable WhatsApp alerts.");
  } finally {
    await source.close();
    await mongoose.disconnect();
  }

  process.exit(0);
}

importSchoolData().catch((error) => {
  console.error(error);
  process.exit(1);
});
