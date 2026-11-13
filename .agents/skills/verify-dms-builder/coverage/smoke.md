# Coverage: smoke

Docs: `1.introduction.md`. Journeys: `journeys/smoke.mjs`.

| Source | Documented behaviour | Journey | Check / Not driven |
| --- | --- | --- | --- |
| dms-builder/docs/1.introduction.md:11 | Retitling a card rewrites its `title` in the page's `PageController` file, and the reloaded page shows it | smoke | POST /page/blocks answers ok with a new version; the card title is in page.ts; GetPageStructure reads it; the rebuilt page shows it |
| dms-builder/docs/1.introduction.md:15 | The builder keeps no database of pages: it reads the sources | smoke | status projectRoot is the run copy; the other blocks are still in the file |
