# SAMS - J. R. Preparatory School Attendance

SAMS is a mobile-first school attendance management system for J. R. Preparatory
School. Teachers can record attendance for their assigned class, while administrators
manage school data, review reports, configure attendance rules, and audit activity.

## Features

- Role-based access for administrators and class-scoped teachers
- Daily attendance with present, absent, late, and half-day statuses
- Physical head-count confirmation before attendance submission
- Configurable attendance edit window
- Dashboard and class-level attendance analytics
- Teacher leave applications with full, partial, or rejected admin decisions
- School-working-day leave analytics with configurable weekly offs and holidays
- CSV and PDF report exports
- CSV import/export for school master data
- Ready-to-send WhatsApp absence alerts using parent phone numbers
- Optional WhatsApp handoffs for leave applications and decision confirmations
- English and Hindi user interface
- Audit logs and forced temporary-credential changes
- Responsive layouts for phones, tablets, and desktop browsers

## Technology

| Area | Stack |
| --- | --- |
| Web | React 19, TypeScript, Vite, React Router, Recharts, i18next |
| API | Node.js 24, Express 5, TypeScript, Zod, Mongoose |
| Data | MongoDB |
| Authentication | JWT access tokens and HTTP-only refresh cookies |
| Testing | Vitest, Supertest, mongodb-memory-server |
| Deployment | Vercel, Render, Docker, GitHub Actions |

## Repository layout

```text
apps/
  api/              Express API, database models, scripts, and integration tests
  web/              React application
packages/
  shared/           Contracts shared across workspaces
.github/workflows/  Continuous integration and deployment workflows
```

## Local development

### Prerequisites

- Node.js 24.x
- npm 11.x
- A local MongoDB instance or MongoDB Atlas database

### 1. Install dependencies

```powershell
git clone https://github.com/Kalpit0710/SAMS_JRP.git
Set-Location SAMS_JRP
npm ci
```

### 2. Configure the API

Create the local API environment file from the checked-in example:

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` and set at least these values:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/sams
JWT_ACCESS_SECRET=<random-value-at-least-16-characters>
JWT_REFRESH_SECRET=<different-random-value-at-least-16-characters>
PUBLIC_APP_URL=http://127.0.0.1:5173
ADMIN_INITIAL_PASSWORD=<unique-temporary-password-at-least-12-characters>
```

Do not commit `.env` files or real credentials.

### 3. Create the initial administrator

With MongoDB available, seed the `admin` account:

```powershell
npm run seed:admin -w @sams/api
```

Sign in with username `admin` and the value of `ADMIN_INITIAL_PASSWORD`. The account
must replace that temporary password on first use.

### 4. Start the application

Run the API and web application in separate terminals:

```powershell
npm run dev -w @sams/api
```

```powershell
npm run dev -w @sams/web
```

Open <http://localhost:5173>. Vite proxies `/api` requests to the API at
<http://localhost:4000>. API health is available at
<http://localhost:4000/api/health>.

## Quality checks

Run all repository checks from the root:

```powershell
npm run lint
npm run build
npm test
```

Useful API data commands:

| Command | Purpose |
| --- | --- |
| `npm run seed:admin -w @sams/api` | Create or reset the initial admin account |
| `npm run db:import -w @sams/api` | Import school data from `SOURCE_MONGO_URI` |
| `npm run db:verify -w @sams/api` | Verify imported school data |
| `npm run db:require-password-change -w @sams/api` | Revoke sessions and require credential changes |

The import supports a destructive `--wipe` option. Back up the target database and
verify both connection strings before using it.

## Deployment

The primary hosted architecture uses Vercel for the React application and Render for
the API, with MongoDB Atlas for persistence. Browser API calls remain same-origin
through the Vercel `/api` proxy so refresh cookies work correctly.

- [Deployment steps](DEPLOYMENT_STEPS.md) - Vercel, Render, Atlas, and GitHub Actions
- [Production runbook](PRODUCTION.md) - alternative single-container deployment
- [Product requirements](PRD.md) - implemented scope and product history
- [QA report](QA_TEST_REPORT_2026-07-31.md) - acceptance and regression results

## Security notes

- Use different MongoDB users, databases, and JWT secrets for development and
  production.
- Store hosted configuration in the provider's secret manager, never in source control.
- Keep refresh cookies same-origin and HTTPS-only in production.
- Treat initial passwords and teacher PINs as temporary credentials.
- Back up production data before imports, upgrades, or operational scripts.