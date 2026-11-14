import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writePrivateFile } from "../../src/state/private-file.js";
import { expectReadableByOwnerOnly } from "../helpers/private-file.js";

const PRIVATE_DIRECTORY_MODE = 0o700;

describe("a private file", () => {
  let root: string;
  let directory: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "dms-assistant-private-"));
    directory = path.join(root, "private");
    file = path.join(directory, "secret.json");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it("is written into a directory only its owner can open, and is owner-only itself (fails a directory left with the parent's access)", async () => {
    await writePrivateFile(file, "first");
    expect(await readFile(file, "utf8")).toBe("first");
    await expectReadableByOwnerOnly(file);
    await expectReadableByOwnerOnly(directory, PRIVATE_DIRECTORY_MODE);
  });

  it.runIf(process.platform === "win32")(
    "is never written when Windows cannot restrict it, leaving no temporary file and the old one untouched (fails a write that falls back to the inherited ACL)",
    async () => {
      await writePrivateFile(file, "first");
      vi.stubEnv("SystemRoot", await mkdtemp(path.join(root, "no-system-")));
      await expect(writePrivateFile(file, "second")).rejects.toThrow();
      expect(await readdir(directory)).toEqual([path.basename(file)]);
      expect(await readFile(file, "utf8")).toBe("first");
    },
  );

  it.runIf(process.platform === "win32")(
    "creates nothing when Windows cannot restrict its directory (fails a file written into an unrestricted directory)",
    async () => {
      vi.stubEnv("SystemRoot", await mkdtemp(path.join(root, "no-system-")));
      await expect(writePrivateFile(file, "first")).rejects.toThrow();
      expect(existsSync(file)).toBe(false);
      expect(await readdir(directory)).toEqual([]);
    },
  );
});
