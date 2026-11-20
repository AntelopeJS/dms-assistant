import { integrationJourneys as connectionCheck } from "../../e2e/builder/journeys/connection-check.mjs";
import { integrationJourneys as database } from "../../e2e/builder/journeys/database.mjs";
import { integrationJourneys as httpApi } from "../../e2e/builder/journeys/http-api.mjs";
import { integrationJourneys as safeModeBuild } from "../../e2e/builder/journeys/safe-mode-build.mjs";
import { integrationJourneys as smoke } from "../../e2e/builder/journeys/smoke.mjs";
import { journeySuite } from "./journeys.mjs";

journeySuite(
  { config: "e2e/builder/journeys.config.ts" },
  {
    smoke,
    "connection-check": connectionCheck,
    database,
    "http-api": httpApi,
    "safe-mode-build": safeModeBuild,
  },
);
