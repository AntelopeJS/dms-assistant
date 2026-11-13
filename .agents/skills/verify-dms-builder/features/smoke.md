---
covers:
  - packages/dms-builder/src/index.ts
docs:
  - packages/dms-builder/docs/1.introduction.md
---

# Smoke

The fixed journey every verdict runs, whatever the diff touches: the introduction's "What one change looks like".

## Sub-features

- `smoke`

## How to get to it (user POV)

- `GET /api/builder/page` on the Board page, then `POST /api/builder/page/blocks` with a card's new title, as the assistant and **Build it** write a page.

## Driving it with dms-control

```bash
dms-control journey "$RUN" smoke
```
