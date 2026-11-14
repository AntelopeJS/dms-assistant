/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs and declared funnel modules. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  why: string;
}

/** The repo-owned layer of the verification skill, read by `dms-control`. */
export interface VerifyConfig {
  playground: string;
  prepare: string[][];
  userFacing: string[];
  notUserFacing: string[];
  smoke: string;
  smokeJourney: string;
  doors: Record<DoorKind, DoorRule | null>;
  formal: never[];
}

const SKILL = ".agents/skills/verify-dms-builder";
const ENGINE = "src/builder/implementations/dms-builder/engine";

const config: VerifyConfig = {
  playground: `${SKILL}/playground`,
  prepare: [
    ["pnpm", "install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    ["pnpm", "run", "build"],
    ["pnpm", "--dir", `${SKILL}/playground`, "install", "--ignore-workspace", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    [`${SKILL}/playground/node_modules/.bin/tsc`, "-p", `${SKILL}/playground/tsconfig.build.json`],
  ],
  userFacing: ["src/builder/**", "frontend-vue/builder/**", "frontend-vue/i18n/locales/builder-*.json"],
  notUserFacing: ["src/builder/test/**", "frontend-vue/builder/tests/**", "frontend-vue/builder/vitest.config.ts"],
  smoke: "smoke",
  smokeJourney: "onboard, list the catalog connections and read the project's modules through /api/builder/database as the owner, and see an anonymous request refused",
  doors: {
    data: {
      globs: [`${ENGINE}/database-connection-remove.ts`, `${ENGINE}/project-config-remove.ts`],
      funnels: [],
      why: "removing a connection takes its modules and their entries out of the project's sources, which a revert of the module does not bring back",
    },
    format: {
      globs: [`${ENGINE}/emit.ts`, `${ENGINE}/resource-emit.ts`, `${ENGINE}/resource-emit-types.ts`, `${ENGINE}/query-emit.ts`, `${ENGINE}/query-template-emit.ts`],
      funnels: [],
      why: "the source that mapping a database writes into a project is read back by the project's own build and by the DMS builder that edits it next",
    },
    contract: {
      globs: ["src/builder/routes/**", "src/builder/constants/routes.ts", "src/builder/config.ts", "frontend-vue/builder/app/runtime/database-types.ts"],
      funnels: [],
      why: "the onboarding popup and agents call these HTTP routes, and projects set the builder config keys",
    },
    outbound: null,
    exposure: {
      globs: ["src/builder/routes/**", "src/builder/config.ts", "src/builder/frontend-module.ts", "src/builder/index.ts"],
      funnels: [],
      why: "these decide who may rewrite the project's sources and open connections to databases, and whether the routes are mounted at all",
    },
    publish: null,
  },
  formal: [],
};

export default config;
