import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ArtifactRecord } from "../../src/artifacts/types.js";
import {
  callApi,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const OWNER = "user-1";
const OTHER = "user-2";

const PAGE = z.object({
  total: z.number(),
  results: z.array(
    z.looseObject({
      id: z.string(),
      title: z.string(),
      kind: z.string(),
      blocks: z.number(),
      spec: z.unknown().optional(),
    }),
  ),
});

const DETAIL = z.looseObject({ id: z.string(), spec: z.looseObject({}) });
const REFUSAL = z.object({ message: z.string() });

function record(
  id: string,
  ownerId: string | undefined,
  title: string,
  createdAtMs: number,
): ArtifactRecord {
  const base: ArtifactRecord = {
    id,
    conversationId: `c-${id}`,
    agent: "claude",
    createdAtMs,
    kind: "report",
    spec: { title, blocks: [{ type: "paragraph", text: "Body." }] },
  };
  return ownerId === undefined ? base : { ...base, ownerId };
}

function seed(harness: WsHarness): void {
  harness.artifacts.add(record("a-1", OWNER, "Refunds Q3", 1));
  harness.artifacts.add(record("a-2", OWNER, "Top customers", 2));
  harness.artifacts.add(record("a-3", OTHER, "Someone else's", 3));
  harness.artifacts.add(record("a-4", undefined, "Nobody's", 4));
}

describe("the artifact routes", () => {
  let harness: WsHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it("lists the viewer's own artifacts newest first, without their blocks, and searches their titles", async () => {
    harness = await startWsHarness({ provider: "claude" });
    seed(harness);
    const listed = PAGE.parse(
      await (await callApi(harness.port, `/artifacts?viewer=${OWNER}`)).json(),
    );
    expect(listed.total).toBe(2);
    expect(listed.results.map((row) => row.id)).toEqual(["a-2", "a-1"]);
    expect(listed.results[0]).not.toHaveProperty("spec");
    expect(listed.results[0]?.blocks).toBe(1);
    const searched = PAGE.parse(
      await (
        await callApi(harness.port, `/artifacts?viewer=${OWNER}&search=REFUND`)
      ).json(),
    );
    expect(searched.results.map((row) => row.title)).toEqual(["Refunds Q3"]);
    const paged = PAGE.parse(
      await (
        await callApi(
          harness.port,
          `/artifacts?viewer=${OWNER}&offset=1&limit=1`,
        )
      ).json(),
    );
    expect([paged.total, paged.results.map((row) => row.id)]).toEqual([
      2,
      ["a-1"],
    ]);
  });

  it("answers another person's artifact and an unknown one alike, as 404 (fails a route that leaks a foreign artifact)", async () => {
    harness = await startWsHarness({ provider: "claude" });
    seed(harness);
    const own = await callApi(harness.port, `/artifacts/a-1?viewer=${OWNER}`);
    expect(own.status).toBe(200);
    expect(DETAIL.parse(await own.json()).id).toBe("a-1");
    const foreign = await callApi(
      harness.port,
      `/artifacts/a-3?viewer=${OWNER}`,
    );
    const unknown = await callApi(
      harness.port,
      `/artifacts/nope?viewer=${OWNER}`,
    );
    expect([foreign.status, unknown.status]).toEqual([404, 404]);
    expect(REFUSAL.parse(await foreign.json())).toEqual(
      REFUSAL.parse(await unknown.json()),
    );
  });

  it("filters the list on a kind it knows, and ignores one it does not", async () => {
    harness = await startWsHarness({ provider: "claude" });
    harness.artifacts.add({
      ...record("a-5", OWNER, "A table", 5),
      kind: "table",
    });
    seed(harness);
    const tables = PAGE.parse(
      await (
        await callApi(harness.port, `/artifacts?viewer=${OWNER}&kind=table`)
      ).json(),
    );
    expect(tables.results.map((row) => row.id)).toEqual(["a-5"]);
    const unknownKind = PAGE.parse(
      await (
        await callApi(harness.port, `/artifacts?viewer=${OWNER}&kind=html`)
      ).json(),
    );
    expect(unknownKind.total).toBe(3);
  });

  it("deletes the viewer's own artifact, and leaves another person's in place answering 404 (fails a route that deletes what it refuses to show)", async () => {
    harness = await startWsHarness({ provider: "claude" });
    seed(harness);
    const deleteAs = (id: string, viewer: string) =>
      callApi(harness?.port ?? 0, `/artifacts/${id}?viewer=${viewer}`, {
        method: "DELETE",
      });
    const own = await deleteAs("a-1", OWNER);
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ deleted: "a-1" });
    expect(harness.artifacts.get("a-1")).toBeNull();
    const foreign = await deleteAs("a-3", OWNER);
    const unknown = await deleteAs("nope", OWNER);
    expect([foreign.status, unknown.status]).toEqual([404, 404]);
    expect(REFUSAL.parse(await foreign.json())).toEqual(
      REFUSAL.parse(await unknown.json()),
    );
    expect(harness.artifacts.get("a-3")?.id).toBe("a-3");
  });

  it("shows a request that names nobody the unowned artifacts alone", async () => {
    harness = await startWsHarness({ provider: "claude" });
    seed(harness);
    const listed = PAGE.parse(
      await (await callApi(harness.port, "/artifacts")).json(),
    );
    expect(listed.results.map((row) => row.id)).toEqual(["a-4"]);
  });
});
