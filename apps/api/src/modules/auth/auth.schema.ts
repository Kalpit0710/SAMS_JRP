import { z } from "zod";
import { SYSTEM_ROLES } from "../../types/auth.js";

/** Teachers sign in with a short numeric PIN, so the floor is 4 rather than 6. */
export const PIN_MIN_LENGTH = 4;

export const LoginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(PIN_MIN_LENGTH),
  activeRole: z.enum(SYSTEM_ROLES).optional()
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(PIN_MIN_LENGTH),
  newPassword: z.string().min(PIN_MIN_LENGTH).max(64)
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  activeRole: z.enum(SYSTEM_ROLES).optional()
});

export const SwitchRoleSchema = z.object({
  activeRole: z.enum(SYSTEM_ROLES)
});

export type RefreshInput = z.infer<typeof RefreshSchema>;
export type SwitchRoleInput = z.infer<typeof SwitchRoleSchema>;
