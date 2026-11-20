import { defineConfig } from "@playwright/test";
import { e2eConfig } from "@antelopejs/dms/e2e";

export default defineConfig(e2eConfig(), { testIgnore: ["builder/**"] });
