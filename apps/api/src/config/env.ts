import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Only NODE_ENV=production may reach the production cluster; test demands an explicit
// MONGODB_URI so a missing value fails loudly instead of falling back to a shared database.
const nodeEnv = process.env.NODE_ENV ?? "development";
const productionUri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
const resolvedMongoUri =
  nodeEnv === "production"
    ? productionUri
    : nodeEnv === "test"
      ? process.env.MONGODB_URI
      : (process.env.MONGODB_URI_DEV ?? process.env.MONGODB_URI);
const resolvedAppVersion =
  process.env.APP_VERSION ?? process.env.RENDER_GIT_COMMIT ?? "1.0.0";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  CORS_ORIGIN: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  PUBLIC_APP_URL: z.string().url().default("http://127.0.0.1:5173"),
  APP_VERSION: z.string().min(1),
  SCHOOL_NAME: z.string().default("J. R. School"),
  ACADEMIC_SESSION: z.string().default("2025-26"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 chars"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 chars")
});

export const env = EnvSchema.parse({
  ...process.env,
  APP_VERSION: resolvedAppVersion,
  MONGODB_URI: resolvedMongoUri
});
