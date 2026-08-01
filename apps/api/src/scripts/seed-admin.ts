import { env } from "../config/env.js";
import { connectDb } from "../lib/db.js";
import { hashPassword, UserModel } from "../models/user.model.js";

async function seedAdmin() {
  await connectDb(env.MONGODB_URI);

  const username = "admin";
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!initialPassword || initialPassword.length < 12) {
    throw new Error("ADMIN_INITIAL_PASSWORD must be set to at least 12 characters");
  }
  const passwordHash = await hashPassword(initialPassword);

  await UserModel.updateOne(
    { username },
    {
      $set: {
        fullName: "SAMS Administrator",
        username,
        passwordHash,
        mustChangePassword: true,
        isActive: true,
        roles: ["admin"]
      }
    },
    { upsert: true }
  );

  console.log("Admin account seeded from ADMIN_INITIAL_PASSWORD and requires a password change.");
  process.exit(0);
}

seedAdmin().catch((error) => {
  console.error(error);
  process.exit(1);
});
