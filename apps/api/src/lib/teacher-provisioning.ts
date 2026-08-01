import crypto from "node:crypto";
import type mongoose from "mongoose";
import { TeacherModel } from "../models/teacher.model.js";
import { UserModel, hashPassword } from "../models/user.model.js";

export async function generateUniqueUsername(fullName: string): Promise<string> {
  const base = fullName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") || "teacher";
  let candidate = base;
  let suffix = 1;
  while (await UserModel.exists({ username: candidate })) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

export type ProvisionedLogin = { fullName: string; username: string; temporaryPin: string };

/** Creates a login User for each teacher (in the given ids) that still lacks one. */
export async function provisionTeacherLogins(
  teacherIds: mongoose.Types.ObjectId[]
): Promise<ProvisionedLogin[]> {
  const teachers = await TeacherModel.find({
    _id: { $in: teacherIds },
    $or: [{ userId: { $exists: false } }, { userId: null }]
  });

  const credentials: ProvisionedLogin[] = [];
  for (const teacher of teachers) {
    const username = await generateUniqueUsername(teacher.fullName);
    const temporaryPin = String(crypto.randomInt(1000, 10000));
    const user = await UserModel.create({
      fullName: teacher.fullName,
      username,
      passwordHash: await hashPassword(temporaryPin),
      roles: ["teacher"],
      mustChangePassword: true,
      isActive: teacher.isActive ?? true
    });
    teacher.userId = user._id;
    await teacher.save();
    credentials.push({ fullName: teacher.fullName, username, temporaryPin });
  }

  return credentials;
}
