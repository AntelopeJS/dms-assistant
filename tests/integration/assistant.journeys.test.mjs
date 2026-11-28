import { integrationJourneys as access } from "../../e2e/journeys/access.mjs";
import { integrationJourneys as activity } from "../../e2e/journeys/activity.mjs";
import { integrationJourneys as changes } from "../../e2e/journeys/changes.mjs";
import { integrationJourneys as codex } from "../../e2e/journeys/codex.mjs";
import { integrationJourneys as lifecycle } from "../../e2e/journeys/lifecycle.mjs";
import { integrationJourneys as onboarding } from "../../e2e/journeys/onboarding.mjs";
import { integrationJourneys as prompts } from "../../e2e/journeys/prompts.mjs";
import { integrationJourneys as settings } from "../../e2e/journeys/settings.mjs";
import { journeySuite } from "./journeys.mjs";

journeySuite(
  {},
  {
    access,
    activity,
    changes,
    codex,
    lifecycle,
    onboarding,
    prompts,
    settings,
  },
);
