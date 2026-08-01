import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { env } from "../../config/env.js";
import { verifyRefreshToken } from "../../lib/token.js";
import { setAuditMeta } from "../../middleware/audit-log.middleware.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { DeviceSessionModel } from "../../models/device-session.model.js";
import { UserModel, hashPassword, verifyPassword } from "../../models/user.model.js";
import { ChangePasswordSchema, LoginSchema, RefreshSchema, SwitchRoleSchema } from "./auth.schema.js";
import { authenticateUser, logoutByToken, refreshAuthToken, switchRole } from "./auth.service.js";

export const authRouter = Router();

const refreshCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000
};

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid login payload",
        errors: parsed.error.flatten()
      });
    }

    const authResult = await authenticateUser(parsed.data, req);

    if (!authResult) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    res.cookie("refreshToken", authResult.tokens.refreshToken, refreshCookieOptions);
    setAuditMeta(res, {
      action: "AUTH_LOGIN",
      resource: "auth",
      userId: authResult.user.id,
      username: authResult.user.username,
      role: authResult.user.activeRole
    });

    return res.status(200).json({
      user: authResult.user,
      accessToken: authResult.tokens.accessToken
    });
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken as string | undefined;
    if (!refreshToken) {
      return res.status(401).json({ message: "Missing refresh token" });
    }

    const parsed = RefreshSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid refresh payload", errors: parsed.error.flatten() });
    }

    try {
      const refreshed = await refreshAuthToken(refreshToken, parsed.data, req);
      if (!refreshed) {
        return res.status(401).json({ message: "Invalid refresh session" });
      }

      res.cookie("refreshToken", refreshed.tokens.refreshToken, refreshCookieOptions);
      setAuditMeta(res, {
        action: "AUTH_REFRESH",
        resource: "auth",
        userId: refreshed.user.id,
        username: refreshed.user.username,
        role: refreshed.user.activeRole
      });

      return res.status(200).json({
        user: refreshed.user,
        accessToken: refreshed.tokens.accessToken
      });
    } catch {
      return res.status(401).json({ message: "Expired refresh token" });
    }
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies.refreshToken as string | undefined;

    if (refreshToken) {
      try {
        const payload = verifyRefreshToken(refreshToken);
        setAuditMeta(res, {
          action: "AUTH_LOGOUT",
          resource: "auth",
          userId: payload.userId,
          role: payload.activeRole
        });
        await logoutByToken(refreshToken);
      } catch {
        // Ignore malformed tokens and always clear cookie.
      }
    }

    res.clearCookie("refreshToken", refreshCookieOptions);
    return res.status(200).json({ message: "Logged out" });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await UserModel.findById(req.auth?.userId).select("fullName username roles isActive");
    if (!user || !user.isActive) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        roles: user.roles,
        activeRole: req.auth?.activeRole,
        mustChangePassword: user.mustChangePassword
      }
    });
  })
);

authRouter.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
    }

    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return res.status(400).json({ message: "The new PIN must be different from the current one" });
    }

    const user = await UserModel.findById(req.auth?.userId);
    if (!user || !user.isActive) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return res.status(401).json({ message: "Current PIN is incorrect" });
    }

    user.passwordHash = await hashPassword(parsed.data.newPassword);
    user.mustChangePassword = false;
    await user.save();

    // Revoke the user's other sessions so a compromised session can't outlive the change.
    await DeviceSessionModel.updateMany(
      { userId: user._id, sessionId: { $ne: req.auth?.sessionId } },
      { $set: { isRevoked: true } }
    );

    setAuditMeta(res, {
      action: "AUTH_CHANGE_PASSWORD",
      resource: "auth",
      userId: user.id,
      username: user.username,
      role: req.auth?.activeRole
    });

    return res.status(200).json({ message: "PIN updated" });
  })
);

authRouter.post(
  "/switch-role",
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = SwitchRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid role payload", errors: parsed.error.flatten() });
    }

    const refreshToken = req.cookies.refreshToken as string | undefined;
    if (!refreshToken) {
      return res.status(401).json({ message: "Missing refresh token" });
    }

    let refreshPayload;
    try {
      refreshPayload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    if (refreshPayload.userId !== req.auth?.userId) {
      return res.status(401).json({ message: "Token mismatch" });
    }

    const switched = await switchRole(parsed.data, req.auth.userId, refreshPayload.sessionId);
    if (!switched) {
      return res.status(403).json({ message: "Cannot switch to requested role" });
    }

    setAuditMeta(res, {
      action: "AUTH_SWITCH_ROLE",
      resource: "auth",
      userId: switched.user.id,
      username: switched.user.username,
      role: switched.user.activeRole,
      metadata: { requestedRole: parsed.data.activeRole }
    });

    res.cookie("refreshToken", switched.tokens.refreshToken, refreshCookieOptions);
    return res.status(200).json({ user: switched.user, accessToken: switched.tokens.accessToken });
  })
);
