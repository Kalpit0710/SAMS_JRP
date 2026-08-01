# SAMS Production Runbook

> The primary Vercel + Render + GitHub Actions deployment path is documented in
> [DEPLOYMENT_STEPS.md](DEPLOYMENT_STEPS.md). This file describes the alternative
> single-container deployment, where Express also serves the compiled React app.

## Architecture

The production container runs one Node.js process on port `4000`:

- `/api/*` is handled by Express.
- The compiled React application is served from `apps/web/dist`.
- Unknown non-API GET routes return `index.html` for client-side routing.
- Hashed assets are cached for one year; `index.html` is never cached.
- Helmet supplies HTTP security headers.

Terminate TLS at the managed hosting ingress or reverse proxy. Do not expose the
container directly over HTTP.

## Required configuration

Set these values through the hosting platform's secret/configuration store. Never put
them in the image or source control.

| Variable             | Production value                                       |
| -------------------- | ------------------------------------------------------ |
| `NODE_ENV`           | `production`                                           |
| `PORT`               | `4000`                                                 |
| `MONGODB_URI`        | Atlas connection string for the `sams` database        |
| `JWT_ACCESS_SECRET`  | Unique random secret, at least 32 characters           |
| `JWT_REFRESH_SECRET` | Different unique random secret, at least 32 characters |
| `CORS_ORIGIN`        | Exact public HTTPS origin                              |
| `TRUST_PROXY`        | Number of trusted ingress proxy hops, normally `1`     |
| `SCHOOL_NAME`        | Public school display name                             |
| `ACADEMIC_SESSION`   | Current school session                                 |
| `APP_VERSION`        | Immutable release identifier                           |

`ADMIN_INITIAL_PASSWORD` is required only when running the admin seed or school-data
import scripts. It must be supplied as a one-time secret and removed afterward.

## Build and run

```powershell
docker build --tag sams:1.0.0 .
docker run --rm --publish 4000:4000 `
  --env-file .env.production `
  sams:1.0.0
```

The hosting platform must restart failed containers and use `GET /api/health` as its
readiness probe. The endpoint returns `503` while MongoDB is unavailable.

After deployment verify:

```powershell
Invoke-RestMethod https://<host>/api/health
Invoke-RestMethod https://<host>/api
```

## Credential activation

Before opening the site to staff:

1. Run `npm run db:require-password-change -w @sams/api` once against Atlas. This
   revokes existing sessions and forces all active users to change temporary credentials.
2. The shared teacher PIN `1234` remains an initial temporary PIN only. Teachers cannot
   access attendance, reports, or alerts until they replace it.
3. Rotate the existing admin password to a unique password. Future seeds/imports read
   the one-time value from `ADMIN_INITIAL_PASSWORD`; no admin password is hardcoded.
4. Confirm the login page contains no prefilled username or password.

## Rollback

Keep the previous immutable image tag. On application regression, route traffic back to
that image without changing Atlas data.
