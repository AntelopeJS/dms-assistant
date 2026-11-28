import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArtifactRecord } from "../../src/artifacts/types.js";
import { createArtifactStore } from "../../src/state/artifacts.js";

const TMP_PREFIX = "dms-assistant-artifacts-";
const FILE_ENCODING = "utf8";

const RECORD: ArtifactRecord = {
  id: "a-1",
  conversationId: "c1",
  ownerId: "user-1",
  createdBy: "Camille",
  agent: "claude",
  createdAtMs: 1,
  kind: "table",
  spec: {
    title: "Top customers",
    blocks: [
      {
        type: "table",
        columns: [{ label: "Customer" }, { label: "Orders", align: "right" }],
        rows: [["Acme", 12]],
      },
    ],
  },
};

describe("the artifact store", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
    filePath = join(dir, "artifacts.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes an added artifact and reads it back", async () => {
    const store = createArtifactStore(filePath);
    await store.load();
    store.add(RECORD);
    await store.flush();
    const reread = createArtifactStore(filePath);
    await reread.load();
    expect(reread.all()).toEqual([RECORD]);
    expect(reread.get("a-1")).toEqual(RECORD);
    expect(reread.get("a-2")).toBeNull();
  });

  it("sets aside a stored artifact whose spec the schema refuses, and writes it back as it was (fails a store that drops it)", async () => {
    const injected = {
      ...RECORD,
      id: "a-2",
      spec: {
        title: "x",
        blocks: [{ type: "html", html: "<script>1</script>" }],
      },
    };
    await writeFile(
      filePath,
      JSON.stringify({ artifacts: [RECORD, injected] }),
      FILE_ENCODING,
    );
    const store = createArtifactStore(filePath);
    await store.load();
    expect(store.all()).toEqual([RECORD]);
    expect(store.get("a-2")).toBeNull();
    store.remove("a-1");
    await store.flush();
    expect(JSON.parse(await readFile(filePath, FILE_ENCODING))).toEqual({
      artifacts: [injected],
    });
  });

  it("removes an artifact once, and says when there was none", async () => {
    const store = createArtifactStore(filePath);
    await store.load();
    store.add(RECORD);
    expect(store.remove("a-1")).toBe(true);
    expect(store.remove("a-1")).toBe(false);
    await store.flush();
    expect(JSON.parse(await readFile(filePath, FILE_ENCODING))).toEqual({
      artifacts: [],
    });
  });

  it("starts empty from a missing or malformed file", async () => {
    const missing = createArtifactStore(filePath);
    await missing.load();
    expect(missing.all()).toEqual([]);
    await writeFile(filePath, "{not json", FILE_ENCODING);
    const malformed = createArtifactStore(filePath);
    await malformed.load();
    expect(malformed.all()).toEqual([]);
  });
});
