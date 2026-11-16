import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isAutoAllowedRead,
  resolveReadRoots,
} from "../../src/agent/read-access.js";

describe("isAutoAllowedRead", () => {
  const ROOTS = [resolve("/work/dms"), resolve("/work/dms/app")];
  const CWD = "/work/dms/app";

  it("allows a read-only tool whose path is inside a root", () => {
    expect(
      isAutoAllowedRead(
        "Read",
        { file_path: "/work/dms/app/page.vue" },
        ROOTS,
        CWD,
      ),
    ).toBe(true);
    expect(
      isAutoAllowedRead(
        "Read",
        { file_path: "/work/dms/modules/dms-assistant/src/x.ts" },
        ROOTS,
        CWD,
      ),
    ).toBe(true);
  });

  it("prompts (returns false) for reads outside every root", () => {
    expect(
      isAutoAllowedRead(
        "Read",
        { file_path: "/home/user/.aws/credentials" },
        ROOTS,
        CWD,
      ),
    ).toBe(false);
  });

  it("resolves relative paths against the project cwd", () => {
    expect(
      isAutoAllowedRead("Read", { file_path: "src/x.ts" }, ROOTS, CWD),
    ).toBe(true);
  });

  it("does not let `..` escape a root", () => {
    expect(
      isAutoAllowedRead("Read", { file_path: "../../etc/passwd" }, ROOTS, CWD),
    ).toBe(false);
  });

  it("treats a path-less Glob/Grep as in-scope (defaults to cwd)", () => {
    expect(isAutoAllowedRead("Glob", { pattern: "**/*.ts" }, ROOTS, CWD)).toBe(
      true,
    );
    expect(isAutoAllowedRead("Grep", {}, ROOTS, CWD)).toBe(true);
  });

  /** Fails on a check that resolves `~/…` or a padded path under the cwd, or ignores an absolute Glob pattern, while the CLI searches the home directory or the pattern's own directory. */
  it("reads a path as the CLI does: `~` expanded, spaces trimmed, an absolute Glob pattern as its directory", () => {
    const escapes: [string, Record<string, string>][] = [
      ["Grep", { pattern: "PRIVATE KEY", path: "~/.ssh" }],
      ["Glob", { pattern: "*", path: "~" }],
      ["Grep", { pattern: "x", path: " /home/user/.aws" }],
      ["Glob", { pattern: "/home/user/.ssh/*" }],
      ["Glob", { pattern: "~/.ssh/*" }],
      ["Glob", { pattern: "/work/dms/../../etc/*" }],
    ];
    for (const [tool, input] of escapes) {
      expect(isAutoAllowedRead(tool, input, ROOTS, CWD)).toBe(false);
    }
    expect(
      isAutoAllowedRead(
        "Glob",
        { pattern: "/work/dms/app/**/*.vue" },
        ROOTS,
        CWD,
      ),
    ).toBe(true);
    expect(
      isAutoAllowedRead("Grep", { pattern: "x", path: " src " }, ROOTS, CWD),
    ).toBe(true);
  });

  it("never auto-allows mutating or non-read tools", () => {
    expect(
      isAutoAllowedRead(
        "Edit",
        { file_path: "/work/dms/app/page.vue" },
        ROOTS,
        CWD,
      ),
    ).toBe(false);
    expect(
      isAutoAllowedRead(
        "Write",
        { file_path: "/work/dms/app/page.vue" },
        ROOTS,
        CWD,
      ),
    ).toBe(false);
    expect(
      isAutoAllowedRead(
        "Bash",
        { command: "cat /work/dms/app/page.vue" },
        ROOTS,
        CWD,
      ),
    ).toBe(false);
  });
});

describe("resolveReadRoots", () => {
  it("includes the host project plus every supplied module root", () => {
    const roots = resolveReadRoots("/work/app", [
      "/work/modules/dms-assistant",
      "/work/modules/dms-base",
    ]);
    expect(roots).toContain(resolve("/work/app"));
    expect(roots).toContain(resolve("/work/modules/dms-assistant"));
    expect(roots).toContain(resolve("/work/modules/dms-base"));
  });

  it("dedupes and ignores blank module roots", () => {
    const roots = resolveReadRoots("/work/app", ["/work/app", ""]);
    expect(roots).toEqual([resolve("/work/app")]);
  });
});
