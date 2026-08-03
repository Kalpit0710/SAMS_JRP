# Branching and Pull Request Workflow

This repository uses two permanent branches and short-lived working branches:

```text
feature/*, fix/*, chore/*  ->  dev  ->  main  ->  production
```

All code changes must use pull requests. Direct pushes to `dev` and `main` are
blocked by active GitHub rulesets with no bypass actors.

## Branch roles

| Branch      | Purpose                                 | Accepts changes from              | Direct pushes |
| ----------- | --------------------------------------- | --------------------------------- | ------------- |
| `main`      | Production-ready code                   | `dev` only, through a PR          | Blocked       |
| `dev`       | Integration branch for the next release | Short-lived branches, through PRs | Blocked       |
| `feature/*` | New functionality                       | Created from `dev`                | Allowed       |
| `fix/*`     | Bug fixes                               | Created from `dev`                | Allowed       |
| `chore/*`   | Maintenance, documentation, or tooling  | Created from `dev`                | Allowed       |

`main` remains the repository's default and production branch. GitHub may therefore
preselect `main` when opening a pull request. Always verify the base branch before
creating the PR.

## Protection and automation

GitHub applies these controls:

- Updates to `dev` require a pull request.
- Updates to `main` require a pull request.
- The required `Validate promotion source` check rejects a PR into `main` unless
  its source branch is exactly `dev`.
- CI runs lint, build, tests, and a production Docker image build for pushes and
  pull requests involving `dev` or `main`.
- A successful push to `main` starts the production deployment workflow after CI.

The source check means these PRs behave differently:

| Pull request                          | Result   |
| ------------------------------------- | -------- |
| `feature/attendance-filter` -> `dev`  | Allowed  |
| `fix/login-timeout` -> `dev`          | Allowed  |
| `dev` -> `main`                       | Allowed  |
| `feature/attendance-filter` -> `main` | Rejected |

## Start new work

Begin every change from an up-to-date `dev` branch:

```powershell
git switch dev
git pull --ff-only origin dev
git switch -c feature/short-description
```

Use a prefix that describes the work:

```powershell
git switch -c feature/teacher-dashboard
git switch -c fix/attendance-date
git switch -c chore/update-documentation
```

Keep each branch focused on one change. Do not branch from `main`, another feature
branch, or an outdated local `dev`.

## Develop and validate

Make changes and run the repository checks from the project root:

```powershell
npm run lint
npm run build
npm test
```

Commit with a concise description:

```powershell
git status
git add <changed-files>
git commit -m "feat: add teacher dashboard filter"
```

Review `git status` and the staged diff before committing. Do not commit secrets,
local environment files, build output, or unrelated changes.

## Push the working branch

Publish the branch and set its upstream:

```powershell
git push -u origin feature/short-description
```

Later commits on the same branch can use:

```powershell
git push
```

## Open a pull request into dev

With GitHub CLI:

```powershell
gh pr create --base dev --head feature/short-description
```

In the GitHub website, confirm the PR header says:

```text
base: dev <- compare: feature/short-description
```

The PR should explain:

- What changed and why.
- How the change was tested.
- Any configuration, migration, deployment, or rollback considerations.
- Screenshots for visible UI changes.

Wait for CI to finish and address review comments. Add follow-up commits to the same
working branch; the PR updates automatically.

## Update a branch from dev

If `dev` changes while the PR is open, rebase the working branch:

```powershell
git fetch origin
git switch feature/short-description
git rebase origin/dev
git push --force-with-lease
```

Use `--force-with-lease`, never plain `--force`. Do not rebase a branch shared with
another developer without coordinating first. Merging `origin/dev` into the working
branch is an acceptable alternative when preserving shared history matters.

## Merge into dev

After checks and review are complete, merge the PR into `dev`. Never delete `dev`.
The short-lived remote branch may be deleted after the merge.

Clean up locally:

```powershell
git switch dev
git pull --ff-only origin dev
git branch -d feature/short-description
git push origin --delete feature/short-description
```

Skip the final command if GitHub already deleted the remote branch.

## Promote dev to main

When the integrated changes on `dev` are ready for production, open one promotion PR:

```powershell
gh pr create --base main --head dev --title "release: promote dev to production"
```

Confirm the PR header says:

```text
base: main <- compare: dev
```

The `Validate promotion source` check must pass. Review the complete release diff,
wait for CI, and merge without deleting `dev`. The resulting `main` push is the
production release signal.

After merging, verify:

1. The production CI run succeeds.
2. The deployment workflow succeeds.
3. The Render API health endpoint reports the new `main` commit SHA.
4. The public Vercel application and proxied API health endpoint are healthy.

## Hotfixes

Direct production hotfixes are intentionally not allowed. A hotfix follows the same
controlled path:

```text
fix/urgent-issue -> dev -> main
```

Create the fix from `dev`, open a PR into `dev`, and then promote `dev` into `main`.
If `dev` contains other unfinished changes, coordinate the release contents before
promotion rather than bypassing branch protection.

## Correct common mistakes

### The PR targets main instead of dev

Change its base branch:

```powershell
gh pr edit <pr-number> --base dev
```

Do not merge a feature branch directly into `main`. The required promotion check will
fail even if the feature's CI checks pass.

### Work started on dev without a new branch

If the changes are not committed, preserve them while creating the branch:

```powershell
git switch -c feature/short-description
```

Then commit and open a PR into `dev`. A direct push to `dev` will be rejected.

### Work started from main

Before opening a PR, move the commits onto a branch based on `dev`. For a simple,
unshared branch:

```powershell
git fetch origin
git switch feature/short-description
git rebase --onto origin/dev origin/main
```

Resolve conflicts, run all checks again, and push with `--force-with-lease` if the
branch was already published. Ask for a second review when the rebase changes the
effective diff substantially.

### A protected-branch push is rejected

This is expected. Do not disable or bypass the ruleset. Create a short-lived branch,
push it, and open the appropriate pull request.

## Quick reference

```powershell
# Start
git switch dev
git pull --ff-only origin dev
git switch -c feature/my-change

# Publish
git push -u origin feature/my-change
gh pr create --base dev --head feature/my-change

# Promote after feature PRs are merged and dev is release-ready
gh pr create --base main --head dev --title "release: promote dev to production"
```
