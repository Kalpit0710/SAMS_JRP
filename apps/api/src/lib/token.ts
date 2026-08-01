import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AccessTokenClaims, RefreshTokenClaims, SystemRole } from "../types/auth.js";

export function signAccessToken(input: {
  userId: string;
  roles: SystemRole[];
  activeRole: SystemRole;
  sessionId: string;
}): string {
  return jwt.sign(input, env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
}

export function signRefreshToken(input: {
  userId: string;
  roles: SystemRole[];
  activeRole: SystemRole;
  sessionId: string;
}): string {
  return jwt.sign(input, env.JWT_REFRESH_SECRET, { expiresIn: "7d" });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenClaims;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenClaims;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSessionId(): string {
  return crypto.randomUUID();
}
