import { describe, expect, it } from "vitest";
import { groundAnalystTurn } from "../../src/agent/host-context.js";
import type { AgentProvider } from "../../src/agent/provider.js";
import { createAgentRunner } from "../../src/agent/runner.js";
import { HOST_CONTEXT_OPEN } from "../../src/constants/agent.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";

const PAGE = { path: "/table-view/table-view-drawer", title: "Drawer Mode" };

function recordingProvider(sent: string[]): AgentProvider {
  return {
    createSession: async () => ({
      runTurn: (input) => {
        sent.push(input.text);
        return (async function* () {})();
      },
      interrupt: () => {},
      dispose: async () => {},
    }),
  };
}

async function sendTurn(includePageContext: boolean): Promise<string> {
  const sent: string[] = [];
  const runner = createAgentRunner(recordingProvider(sent), {
    settings: DEFAULT_SETTINGS,
    ground: groundAnalystTurn,
  });
  for await (const _ of runner.start("what is on this page?", {
    conversationId: "conv",
    hostProjectRoot: "/tmp",
    getCurrentPage: () => PAGE,
    includePageContext,
  })) {
  }
  await runner.dispose();
  const [text] = sent;
  if (text === undefined) throw new Error("no turn reached the provider");
  return text;
}

describe("an Analyst-grounded runner turn", () => {
  it("sends the page block when the page chip is kept", async () => {
    const text = await sendTurn(true);
    expect(text.startsWith(HOST_CONTEXT_OPEN)).toBe(true);
    expect(text).toContain(`page: ${PAGE.path}`);
    expect(text).toContain(`title: ${PAGE.title}`);
    expect(text.endsWith("what is on this page?")).toBe(true);
  });

  it("sends the bare message when the page chip was removed", async () => {
    expect(await sendTurn(false)).toBe("what is on this page?");
  });
});
