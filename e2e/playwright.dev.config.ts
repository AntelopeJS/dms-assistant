import { defineConfig } from "@playwright/test";
import { e2eConfig } from "@antelopejs/dms/e2e";

export default defineConfig(
  e2eConfig({
    skill: ".agents/skills/verify-dms-assistant",
    frontend: "dev",
  }),
  { testIgnore: ["builder/**"] },
);
