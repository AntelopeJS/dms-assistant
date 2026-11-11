import { afterEach, describe, expect, it } from "vitest";
import {
  CLIENT_TOKEN,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const LIST_TOOLS = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
});

function listProjectTools(harness: WsHarness): Promise<Response> {
  return fetch(`http://127.0.0.1:${harness.port}/mcp/project`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CLIENT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: LIST_TOOLS,
  });
}

describe("the project MCP endpoint by runtime", () => {
  let harness: WsHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it("serves the project's tools to outside sessions in development", async () => {
    harness = await startWsHarness({ provider: "claude" });
    const response = await listProjectTools(harness);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"name":"typecheck"');
  });

  it("serves no tool in production (fails a sidecar that hands the project's tools to outside sessions wherever it runs)", async () => {
    harness = await startWsHarness({
      provider: "claude",
      isDevelopment: false,
    });
    const response = await listProjectTools(harness);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('"tools"');
  });
});
