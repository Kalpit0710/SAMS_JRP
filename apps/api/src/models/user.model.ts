import bcrypt from "bcryptjs";
import mongoose, { InferSchemaType } from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    roles: {
      type: [String],
      enum: ["admin", "teacher"],
      default: ["teacher"]
    },
    mustChangePassword: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);
export type UserDocument = InferSchemaType<typeof userSchema>;

export const UserModel = mongoose.model("User", userSchema);

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
