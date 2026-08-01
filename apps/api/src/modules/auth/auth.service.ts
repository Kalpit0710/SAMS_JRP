import type { Request } from "express";
import { createSessionId, hashToken, signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/token.js";
import { DeviceSessionModel } from "../../models/device-session.model.js";
import { UserModel, verifyPassword } from "../../models/user.model.js";
import type { SystemRole } from "../../types/auth.js";
import type { LoginInput, RefreshInput, SwitchRoleInput } from "./auth.schema.js";

function getRequestMeta(req: Request) {
  return {
    userAgent: req.headers["user-agent"] ?? "unknown",
    ipAddress: req.ip ?? "unknown"
  };
}

function pickRole(candidateRole: SystemRole | undefined, roles: SystemRole[]): SystemRole {
  if (candidateRole && roles.includes(candidateRole)) {
    return candidateRole;
  }

  return roles[0];
}

export async function authenticateUser(input: LoginInput, req: Request) {
  const user = await UserModel.findOne({ username: input.username.toLowerCase(), isActive: true });

  if (!user) {
    return null;
  }

  const validPassword = await verifyPassword(input.password, user.passwordHash);

  if (!validPassword) {
    return null;
  }

  const roles = user.roles as SystemRole[];
  const activeRole = pickRole(input.activeRole, roles);
  const sessionId = createSessionId();

  const refreshToken = signRefreshToken({
    userId: user.id,
    roles,
    activeRole,
    sessionId
  });

  const accessToken = signAccessToken({ userId: user.id, roles, activeRole, sessionId });

  const requestMeta = getRequestMeta(req);

  await DeviceSessionModel.create({
    userId: user.id,
    sessionId,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: requestMeta.userAgent,
    ipAddress: requestMeta.ipAddress,
    activeRole,
    isRevoked: false,
    lastSeenAt: new Date()
  });

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      roles,
      activeRole,
      mustChangePassword: user.mustChangePassword
    },
    tokens: {
      accessToken,
      refreshToken
    }
  };
}

export async function refreshAuthToken(refreshToken: string, input: RefreshInput, req: Request) {
  const payload = verifyRefreshToken(refreshToken);

  const user = await UserModel.findById(payload.userId);
  if (!user || !user.isActive) {
    return null;
  }

  const roles = user.roles as SystemRole[];
  const activeRole = pickRole(input.activeRole ?? payload.activeRole, roles);

  const nextRefreshToken = signRefreshToken({
    userId: user.id,
    roles,
    activeRole,
    sessionId: payload.sessionId
  });
  const nextAccessToken = signAccessToken({
    userId: user.id,
    roles,
    activeRole,
    sessionId: payload.sessionId
  });

  const currentHash = hashToken(refreshToken);
  const nextHash = hashToken(nextRefreshToken);
  const requestMeta = getRequestMeta(req);

  // Atomic compare-and-swap: only the request presenting the current hash rotates it,
  // so parallel refreshes can't each rotate and evict one another (Deep-H02).
  const rotated = await DeviceSessionModel.findOneAndUpdate(
    {
      sessionId: payload.sessionId,
      userId: payload.userId,
      isRevoked: false,
      refreshTokenHash: currentHash
    },
    {
      $set: {
        refreshTokenHash: nextHash,
        activeRole,
        userAgent: requestMeta.userAgent,
        ipAddress: requestMeta.ipAddress,
        lastSeenAt: new Date()
      }
    },
    { new: true }
  );

  if (!rotated) {
    // A concurrent request that produced the identical next token (same second) already
    // rotated to it; treat that as success instead of forcing a sign-out.
    const alreadyRotated = await DeviceSessionModel.findOne({
      sessionId: payload.sessionId,
      userId: payload.userId,
      isRevoked: false,
      refreshTokenHash: nextHash
    });
    if (!alreadyRotated) {
      return null;
    }
  }

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      roles,
      activeRole,
      mustChangePassword: user.mustChangePassword
    },
    tokens: {
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken
    }
  };
}

export async function logoutByToken(refreshToken: string) {
  const payload = verifyRefreshToken(refreshToken);

  const session = await DeviceSessionModel.findOne({
    sessionId: payload.sessionId,
    userId: payload.userId,
    isRevoked: false
  });

  if (!session) {
    return;
  }

  session.isRevoked = true;
  session.lastSeenAt = new Date();
  await session.save();
}

export async function switchRole(input: SwitchRoleInput, userId: string, currentSessionId: string) {
  const user = await UserModel.findById(userId);
  if (!user || !user.isActive) {
    return null;
  }

  const roles = user.roles as SystemRole[];
  if (!roles.includes(input.activeRole)) {
    return null;
  }

  const session = await DeviceSessionModel.findOne({
    sessionId: currentSessionId,
    userId,
    isRevoked: false
  });

  if (!session) {
    return null;
  }

  const nextAccessToken = signAccessToken({ userId: user.id, roles, activeRole: input.activeRole, sessionId: currentSessionId });
  const nextRefreshToken = signRefreshToken({
    userId: user.id,
    roles,
    activeRole: input.activeRole,
    sessionId: currentSessionId
  });

  session.activeRole = input.activeRole;
  session.refreshTokenHash = hashToken(nextRefreshToken);
  session.lastSeenAt = new Date();
  await session.save();

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      roles,
      activeRole: input.activeRole,
      mustChangePassword: user.mustChangePassword
    },
    tokens: {
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken
    }
  };
}
