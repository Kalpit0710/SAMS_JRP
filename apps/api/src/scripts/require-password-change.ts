import mongoose from "mongoose";
import { env } from "../config/env.js";
import { connectDb } from "../lib/db.js";
import { DeviceSessionModel } from "../models/device-session.model.js";
import { UserModel } from "../models/user.model.js";

async function requirePasswordChange() {
  await connectDb(env.MONGODB_URI);

  const users = await UserModel.updateMany(
    { isActive: true },
    { $set: { mustChangePassword: true } }
  );
  const sessions = await DeviceSessionModel.updateMany(
    { isRevoked: false },
    { $set: { isRevoked: true } }
  );

  console.log(`Marked ${users.modifiedCount} active user(s) for credential change.`);
  console.log(`Revoked ${sessions.modifiedCount} active session(s).`);
  await mongoose.disconnect();
}

requirePasswordChange().catch((error) => {
  console.error(error);
  process.exit(1);
});