# SAMS Deployment Steps

This runbook deploys the React application to Vercel, the Express API to Render,
and uses GitHub Actions for CI/CD. The `main` branch is the single production source.

## 1. Deployment model

| Git branch | GitHub environment | Vercel project  | Render service  | MongoDB database |
| ---------- | ------------------ | --------------- | --------------- | ---------------- |
| `main`     | `production`       | `sams-web-prod` | `sams-api-prod` | `sams`           |

Vercel reverse-proxies `/api/*` to Render by using `API_ORIGIN`. Browser requests
therefore remain same-origin, which is required for the HTTP-only refresh cookie.
Do not change the web app to call an `onrender.com` URL directly.

Render automatic deployments are disabled in `render.yaml`. GitHub Actions deploys
an exact commit only after lint, build, tests, and the Docker build pass. Production
uses a paid Render instance to avoid free-tier sleep and cold-start behavior.

## 2. Prerequisites

- Node.js 24 and npm 11
- A GitHub account and an empty GitHub repository
- A Vercel account
- A Render account
- A MongoDB Atlas project
- GitHub CLI (`gh`) or Git plus the GitHub website
- Docker for the local container check (optional locally, mandatory in CI)

Run the local release checks from the repository root:

```powershell
npm ci
npm run lint
npm run build
npm test
docker build --tag sams:predeploy .
```

## 3. Create and push the Git repository

This folder is not currently initialized as a Git repository. Replace the repository
name in the command below if needed.

```powershell
git init -b main
git add .
git commit -m "Prepare SAMS deployment"
gh repo create attendance-system --private --source . --remote origin --push
```

Without GitHub CLI, create the empty repository in GitHub and then run:

```powershell
git remote add origin https://github.com/<owner>/<repository>.git
git push --set-upstream origin main
```

Protect `main`. Require the `Lint, build, and test` and `Build production image`
checks before merge, and require pull requests.

## 4. Prepare MongoDB Atlas

1. Create a least-privilege Atlas database user for production.
2. Use the `sams` database.
3. Put the database name explicitly in the connection string. A URI without it can
   silently use the `test` database.
4. Add Render's outbound ranges to Atlas Network Access when the selected Render plan
  provides stable ranges. If dynamic egress requires `0.0.0.0/0`, use a strong unique
  database password and a least-privilege user.
5. Back up the production database before the first production deployment.

## 5. Create the Vercel projects

Create one Vercel project from the GitHub repository:

1. Create `sams-web-prod`; set its production branch to `main`.
2. Use the repository root as the project root. The checked-in `vercel.json` supplies
   the install command, web build command, output directory, SPA fallback, security
   headers, and API proxy.
3. Record the project's stable Vercel URL.
4. Disconnect Vercel's Git integration after project creation, or disable its automatic
   Git deployments. GitHub Actions is the deployment owner and duplicate deploys should
   not run in parallel.

The API URL is not known yet. Add `API_ORIGIN` after creating the Render service.

## 6. Create the Render services

Before syncing the Blueprint, confirm that `main` exists on GitHub.

1. In Render, select **New > Blueprint**.
2. Connect the GitHub repository and use the root `render.yaml`.
3. Confirm that Render will create the `sams` project with one `production` environment
  containing the `sams-api-prod` service from `main`.
4. Enter the prompted values for the service:

| Render variable    | Production value                          |
| ------------------ | ----------------------------------------- |
| `MONGODB_URI`      | Atlas URI ending in `/sams`                |
| `CORS_ORIGIN`      | Exact `https://...` URL of `sams-web-prod` |
| `SCHOOL_NAME`      | Production school name                    |
| `ACADEMIC_SESSION` | Current production session                |

Render generates `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. Keep
`NODE_ENV=production` so secure cookies and production error handling remain enabled.

Wait for the initial service to become healthy, then record its Render origin:

```text
https://sams-api-prod.onrender.com
```

Actual service URLs can differ if the names are already taken.

## 7. Finish Vercel configuration

In the Vercel project, add a **Production** environment variable named `API_ORIGIN`.
Use the Render origin without a trailing slash:

| Vercel project  | `API_ORIGIN`             |
| --------------- | ------------------------ |
| `sams-web-prod` | Production Render origin |

The workflow runs `vercel deploy --prod` against this project after Render is healthy.

## 8. Configure GitHub environments

Create one GitHub environment named exactly `production` under
**Repository Settings > Environments**.

Allow deployments only from `main`, add a required reviewer, and prevent self-review
when your GitHub plan supports it.

Add these secrets to the environment:

| Secret                   | Value                                     |
| ------------------------ | ----------------------------------------- |
| `RENDER_DEPLOY_HOOK_URL` | Render service Settings > Deploy Hook     |
| `VERCEL_TOKEN`           | A scoped Vercel access token              |
| `VERCEL_ORG_ID`          | Vercel account/team ID owning the project |
| `VERCEL_PROJECT_ID`      | ID of the matching Vercel project         |

Add these non-secret environment variables:

| Variable         | Value                                         |
| ---------------- | --------------------------------------------- |
| `RENDER_API_URL` | Matching Render origin, no trailing slash     |
| `WEB_URL`        | Matching stable Vercel URL, no trailing slash |

Project and team IDs are shown in Vercel project settings and in the generated
`.vercel/project.json` after linking a project locally. Do not commit `.vercel`.

## 9. Run the first deployments

A successful CI run after a push to `main` starts the protected production deployment.
The deployment job waits for the configured GitHub environment approval.

You can also run **Actions > Deploy > Run workflow**. Manual deployment resolves the
current `main` tip and records its SHA.

The CD workflow performs these gates in order:

1. Trigger Render with the exact commit SHA.
2. Wait until `/api/health` is healthy and reports that SHA.
3. Deploy the matching Vercel project.
4. Check the public web URL and its proxied `/api/health` endpoint.

## 10. Initialize application credentials

Do not permanently add `ADMIN_INITIAL_PASSWORD`, `SOURCE_MONGO_URI`, or
`DEFAULT_TEACHER_PIN` to Render. Run one-time data or credential scripts from a trusted
operator machine with the target `MONGODB_URI` loaded locally.

For an existing populated production database, run the password-change activation
before opening the site to staff:

```powershell
$env:MONGODB_URI = '<production-atlas-uri>'
$env:JWT_ACCESS_SECRET = '<temporary-local-value-at-least-32-characters>'
$env:JWT_REFRESH_SECRET = '<different-temporary-local-value-at-least-32-characters>'
npm run db:require-password-change -w @sams/api
```

Remove those values from the terminal session afterward. Rotate the admin password and
confirm teachers must replace temporary PINs before accessing application data.

## 11. Post-deployment verification

Run these checks against production:

```powershell
Invoke-RestMethod https://<render-host>/api/health
Invoke-RestMethod https://<vercel-host>/api/health
Invoke-WebRequest https://<vercel-host> -UseBasicParsing
```

Confirm all of the following:

- Direct and proxied health responses are `healthy` and show the deployed Git SHA.
- Login, refresh, logout, and forced PIN change work.
- An admin can load master data, reports, attendance, alerts, and audit logs.
- A teacher sees only the assigned class.
- CSV export downloads successfully.
- Browser developer tools show `/api/*` requests on the Vercel host, not directly on
  the Render host.
- No secrets appear in build logs or client JavaScript.

## 12. Rollback

1. In Vercel, promote the previous known-good deployment for the affected project.
2. In Render, redeploy the previous known-good commit from deployment history.
3. Verify direct and proxied `/api/health` responses.
4. Do not roll back MongoDB data unless a separately reviewed data-restoration plan
   requires it. The application currently has no automated schema migration step.

For a code rollback, prefer a Git revert committed to the affected branch. It produces
an auditable release and lets the normal CI/CD gates validate the rollback.

## Troubleshooting

- **Vercel returns 404 on client routes:** confirm the repository-root `vercel.json`
  was detected and the Vercel output directory is the repository-root `dist`.
- **`API_ORIGIN` appears literally in a route:** add it to the Production environment
  of the matching Vercel project and redeploy.
- **CORS blocked:** set Render `CORS_ORIGIN` to the exact Vercel origin, including
  `https://` and excluding a trailing slash. Multiple origins are comma-separated.
- **Login works but refresh fails:** confirm requests use the Vercel `/api` proxy and
  `NODE_ENV=production` is set on Render.
- **Render health never reaches the expected SHA:** verify the deploy hook belongs to
  the correct service and Render exposes `RENDER_GIT_COMMIT` for the deployment.
- **Atlas TLS or connection timeout:** verify the Atlas cluster is active, the URI has
  the intended database name, credentials are correct, and Render egress is allowed.
