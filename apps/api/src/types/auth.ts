export const SYSTEM_ROLES = ["admin", "teacher"] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

export type AccessTokenClaims = {
  userId: string;
  roles: SystemRole[];
  activeRole: SystemRole;
  sessionId: string;
};

export type RefreshTokenClaims = AccessTokenClaims;
