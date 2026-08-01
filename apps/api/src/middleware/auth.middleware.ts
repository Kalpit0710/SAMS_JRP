import type { NextFunction, Request, Response } from "express";
import { DeviceSessionModel } from "../models/device-session.model.js";
import { UserModel } from "../models/user.model.js";
import { verifyAccessToken } from "../lib/token.js";
import type { AccessTokenClaims, SystemRole } from "../types/auth.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing bearer token" });
  }

  try {
    const token = header.slice(7);
    const payload = verifyAccessToken(token);

    const user = await UserModel.findById(payload.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "Invalid account" });
    }

    const passwordChangeAllowed = new Set(["/api/auth/me", "/api/auth/change-password"]);
    if (user.mustChangePassword && !passwordChangeAllowed.has(req.originalUrl.split("?")[0])) {
      return res.status(403).json({
        message: "Change your temporary PIN before continuing",
        code: "PASSWORD_CHANGE_REQUIRED"
      });
    }

    // Revoked sessions (logout, PIN reset) invalidate their access tokens immediately.
    const session = await DeviceSessionModel.exists({
      sessionId: payload.sessionId,
      userId: payload.userId,
      isRevoked: false
    });
    if (!session) {
      return res.status(401).json({ message: "Session ended" });
    }

    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function requireRoles(allowedRoles: SystemRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!allowedRoles.includes(req.auth.activeRole)) {
      return res.status(403).json({ message: "Permission denied" });
    }

    return next();
  };
}
