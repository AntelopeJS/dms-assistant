import { integrationJourneys as connectionCheck } from "../../e2e/builder/journeys/connection-check.mjs";
import { integrationJourneys as database } from "../../e2e/builder/journeys/database.mjs";
import { integrationJourneys as httpApi } from "../../e2e/builder/journeys/http-api.mjs";
import { integrationJourneys as smoke } from "../../e2e/builder/journeys/smoke.mjs";
import { journeySuite } from "./journeys.mjs";

journeySuite(".agents/skills/verify-dms-builder", {
  smoke,
  "connection-check": connectionCheck,
  database,
  "http-api": httpApi,
});
