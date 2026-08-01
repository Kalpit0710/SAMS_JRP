/** Post-import sanity check against the target database. */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDb } from "../lib/db.js";
import { ClassModel } from "../models/class.model.js";
import { StudentModel } from "../models/student.model.js";
import { TeacherModel } from "../models/teacher.model.js";
import { UserModel } from "../models/user.model.js";

async function verify() {
  await connectDb(env.MONGODB_URI);
  console.log(`Database: ${mongoose.connection.db?.databaseName}\n`);

  const classes = await ClassModel.find({}).sort({ name: 1 }).lean();
  const teachers = await TeacherModel.find({}).lean();
  const teacherByClass = new Map(teachers.filter((t) => t.classId).map((t) => [String(t.classId), t]));

  console.log("Class                 Students  Teacher");
  let total = 0;
  for (const item of classes) {
    const count = await StudentModel.countDocuments({ classId: item._id });
    total += count;
    console.log(
      `${item.name.padEnd(20)} ${String(count).padStart(8)}  ${teacherByClass.get(String(item._id))?.fullName ?? "-"}`
    );
  }

  console.log(`\nTotals: classes=${classes.length} teachers=${teachers.length} students=${total}`);
  console.log(`Users: ${await UserModel.countDocuments({})} (admins=${await UserModel.countDocuments({ roles: "admin" })})`);

  const orphans = await StudentModel.countDocuments({ classId: { $nin: classes.map((c) => c._id) } });
  const teacherNoUser = await TeacherModel.countDocuments({ userId: { $exists: false } });
  console.log(`Orphan students: ${orphans} | teachers without a login: ${teacherNoUser}`);

  const sample = await StudentModel.findOne({}).sort({ regNo: 1 }).lean();
  console.log("\nSample student:", JSON.stringify(sample, null, 2));

  await mongoose.disconnect();
  process.exit(0);
}

verify().catch((error) => {
  console.error(error);
  process.exit(1);
});
