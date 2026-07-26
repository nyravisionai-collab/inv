# CI workflow

`ci.yml` in this directory contains the pipeline for this project. It lives
here rather than in `.github/workflows/` because the automation account that
opened the pull request does not hold GitHub's `workflows` permission and is
blocked from writing to that directory.

To enable it, a maintainer moves the file into place:

```bash
mkdir -p .github/workflows
git mv .github/ci/ci.yml .github/workflows/ci.yml
git commit -m "ci: enable pipeline"
```

## What it runs

| Job | Steps |
|---|---|
| `backend` | `npm ci` → `npm run lint` → `npm test` (54 tests) → `npm audit --omit=dev --audit-level=high` |
| `frontend` | `npm ci` → `npm run lint` → `npm run i18n:check` → `npm run build` → production audit |
| `secrets` | Fails if `.env`, `*.db`, or anything under `backups/` is ever committed |

All three run on every push and pull request. Until the workflow is enabled,
the same checks are available locally:

```bash
cd inventory-system && npm run verify
```
