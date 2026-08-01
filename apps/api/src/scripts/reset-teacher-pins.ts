/**
 * Sets every teacher's PIN to a known value so they can sign in, then change it themselves.
 * Usage: npx tsx src/scripts/reset-teacher-pins.ts [newPin]
 */
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDb } from "../lib/db.js";
import { DeviceSessionModel } from "../models/device-session.model.js";
import { TeacherModel } from "../models/teacher.model.js";
import { UserModel, hashPassword } from "../models/user.model.js";

const newPin = process.argv[2] ?? "1234";

async function resetPins() {
  await connectDb(env.MONGODB_URI);

  const teachers = await TeacherModel.find({}).select("fullName userId").lean();
  const passwordHash = await hashPassword(newPin);
  let updated = 0;

  for (const teacher of teachers) {
    if (!teacher.userId) {
      console.log(`Skipped ${teacher.fullName} - no login account`);
      continue;
    }

    const user = await UserModel.findByIdAndUpdate(
      teacher.userId,
      { $set: { passwordHash, mustChangePassword: true } },
      { returnDocument: "after" }
    );

    if (!user) {
      console.log(`Skipped ${teacher.fullName} - linked account missing`);
      continue;
    }

    await DeviceSessionModel.updateMany({ userId: user._id }, { $set: { isRevoked: true } });
    console.log(`${teacher.fullName.padEnd(22)} -> ${user.username}`);
    updated += 1;
  }

  console.log(`\n${updated} teacher PIN(s) set to "${newPin}".`);
  console.log("Ask teachers to change it from Settings after their first sign-in.");

  await mongoose.disconnect();
  process.exit(0);
}

resetPins().catch((error) => {
  console.error(error);
  process.exit(1);
});
