---
covers:
  - src/builder/index.ts
docs:
  - docs/8.database-connection.md
---

# Smoke

The fixed journey every verdict runs, whatever the diff touches: the first call of the onboarding's "Start from an existing database" path.

## Sub-features

- `smoke`

## How to get to it (user POV)

- `GET /api/builder/database/connections` and `GET /api/builder/database/project` as the owner, then the same without signing in.

## Driving it with dms-control

```bash
dms-control journey "$RUN" smoke
```
