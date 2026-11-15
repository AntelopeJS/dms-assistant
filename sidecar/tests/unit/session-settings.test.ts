import { join, matchesGlob } from "node:path";
import { describe, expect, it } from "vitest";
import { SECRET_FILE_READ_DENY_RULES } from "../../src/providers/claude/session-settings.js";

const ROOT = "/work/app";
const RULE = /^Read\(\/\/(.+)\)$/;

const ruleGlobs = SECRET_FILE_READ_DENY_RULES.map(
  (rule) => RULE.exec(rule)?.[1] ?? rule,
);

const isDenied = (path: string) =>
  ruleGlobs.some((glob) => matchesGlob(path, `/${glob}`));

describe("the Read rules that keep secret files out of a skill's @ references", () => {
  /** Fails on rules anchored on the session's working directory, which let an `@` reference to a `.env` above or beside it through. */
  it("anchor every rule at the filesystem root", () => {
    expect(
      SECRET_FILE_READ_DENY_RULES.filter(
        (rule) => !rule.startsWith("Read(//**/"),
      ),
    ).toEqual([]);
  });

  it.each(["/elsewhere/monorepo/.env", "/home/owner/skills/probe/.env.local"])(
    "deny %s outside the project",
    (path) => {
      expect(isDenied(path)).toBe(true);
    },
  );

  /** Fails on rules that keep a `[!...]` class, which Claude Code reads as the characters it lists: `.env.local` then slips through and `.env.example` is refused. */
  it("spell every excluded character class out as the characters it keeps", () => {
    expect(
      SECRET_FILE_READ_DENY_RULES.filter((rule) => rule.includes("[!")),
    ).toEqual([]);
  });

  it.each([
    ".env",
    ".env.local",
    ".ENV.Production",
    ".env.e",
    ".env.examples",
    ".env.sampled",
    join("apps", "site", ".env.development"),
  ])("deny %s", (file) => {
    expect(isDenied(join(ROOT, file))).toBe(true);
  });

  it.each([
    ".env.example",
    ".env.sample",
    ".env.template",
    ".Env.Example",
    join("src", "index.ts"),
    "environment.ts",
  ])("leave %s readable", (file) => {
    expect(isDenied(join(ROOT, file))).toBe(false);
  });
});
