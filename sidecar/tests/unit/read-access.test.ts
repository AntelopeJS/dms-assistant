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

  it("auto-allows only a search it can place inside a root and leaves every other one to the person", () => {
    const unplaced: [string, Record<string, string>][] = [
      ["Grep", { pattern: "PRIVATE KEY", path: "~/.ssh" }],
      ["Glob", { pattern: "*", path: "~" }],
      ["Grep", { pattern: "x", path: " /home/user/.aws" }],
      ["Grep", { pattern: "x", path: "/work/dms/app/.. /.." }],
      ["Glob", { pattern: "*", path: "/work/dms/ ../x" }],
      ["Glob", { pattern: "/home/user/.ssh/*" }],
      ["Glob", { pattern: "/work/dms/app/**/*.vue" }],
      ["Glob", { pattern: "/work/dms/x]/../../outside/*" }],
      ["Glob", { pattern: "/work/dms" }],
      ["Glob", { pattern: "/work/dms/.. /*" }],
      ["Glob", { pattern: "/work/dms/.. /x.txt" }],
      ["Glob", { pattern: "C:/**/*.pem" }],
      ["Glob", { pattern: "C:\\*" }],
      ["Glob", { pattern: "~/.ssh/*" }],
      ["Glob", { pattern: "../outside/*" }],
      ["Glob", { pattern: "src/../../*" }],
      ["Glob", { pattern: ".. /*" }],
    ];
    for (const [tool, input] of unplaced) {
      expect(
        isAutoAllowedRead(tool, input, ROOTS, CWD),
        JSON.stringify(input),
      ).toBe(false);
    }
    const placed: [string, Record<string, string>][] = [
      ["Glob", { pattern: "**/*.vue" }],
      ["Glob", { pattern: "pages/[id]/*.vue", path: "src" }],
      ["Glob", { pattern: "{a,b}/*.ts", path: "/work/dms/app" }],
      ["Grep", { pattern: "x", path: " src " }],
      ["Grep", { pattern: "x", path: "src/../lib" }],
    ];
    for (const [tool, input] of placed) {
      expect(
        isAutoAllowedRead(tool, input, ROOTS, CWD),
        JSON.stringify(input),
      ).toBe(true);
    }
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
