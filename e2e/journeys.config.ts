import type { JourneysConfig } from "@antelopejs/dms/e2e";

const PLAYGROUND = "e2e/playground";

export default {
  playground: PLAYGROUND,
  prepare: [
    [
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    ["pnpm", "run", "build"],
    ["pnpm", "run", "build:sidecar"],
    [
      "pnpm",
      "install",
      "--dir",
      PLAYGROUND,
      "--ignore-workspace",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    [
      `${PLAYGROUND}/node_modules/.bin/tsc`,
      "-p",
      `${PLAYGROUND}/tsconfig.build.json`,
    ],
  ],
  smoke: "smoke",
} satisfies JourneysConfig;
