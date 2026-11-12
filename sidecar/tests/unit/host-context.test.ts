import { describe, expect, it } from "vitest";
import {
  formatAnalystPageContext,
  formatHostContext,
  groundAnalystTurn,
  prependHostContext,
} from "../../src/agent/host-context.js";
import {
  HOST_CONTEXT_CLOSE,
  HOST_CONTEXT_OPEN,
  HOST_CONTEXT_UNKNOWN_VALUE,
} from "../../src/constants/agent.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";

describe("host context block", () => {
  it("states path, title, file and mode when all are known", () => {
    const block = formatHostContext(
      {
        path: "/form/form-simple",
        filepath: "/project/modules/demo/form-simple/page.ts",
        title: "Simple form",
      },
      "vibe",
    );
    expect(block).toBe(
      `${HOST_CONTEXT_OPEN}\n` +
        "page: /form/form-simple\n" +
        "title: Simple form\n" +
        "file: /project/modules/demo/form-simple/page.ts\n" +
        "mode: code\n" +
        HOST_CONTEXT_CLOSE,
    );
  });

  it("reads unknown for a title or file that could not be determined", () => {
    const block = formatHostContext({ path: "/dashboard" }, "safe");
    expect(block).toBe(
      `${HOST_CONTEXT_OPEN}\n` +
        "page: /dashboard\n" +
        "title: unknown\n" +
        "file: unknown\n" +
        "mode: safe\n" +
        HOST_CONTEXT_CLOSE,
    );
  });

  it("prepends the block above the user's message", () => {
    const grounded = prependHostContext(
      "add a chart",
      { path: "/overview" },
      "vibe",
    );
    expect(grounded.startsWith(HOST_CONTEXT_OPEN)).toBe(true);
    expect(grounded.endsWith("add a chart")).toBe(true);
    expect(grounded).toContain("page: /overview");
    expect(grounded).toContain("mode: code");
  });
});

describe("Analyst page context", () => {
  it("states the page's path and title above the message, nothing else", () => {
    expect(
      groundAnalystTurn("how many tasks are late?", {
        path: "/table-view/table-view-drawer",
        title: "Drawer Mode",
        filepath: "/project/modules/demo/drawer/page.ts",
      }),
    ).toBe(
      `${HOST_CONTEXT_OPEN}\n` +
        "page: /table-view/table-view-drawer\n" +
        "title: Drawer Mode\n" +
        `${HOST_CONTEXT_CLOSE}\n\n` +
        "how many tasks are late?",
    );
  });

  it("states the path alone when the page has no title", () => {
    expect(formatAnalystPageContext({ path: "/sales" })).toBe(
      `${HOST_CONTEXT_OPEN}\npage: /sales\n${HOST_CONTEXT_CLOSE}`,
    );
  });

  it("leaves the message alone when the page chip was removed", () => {
    expect(
      groundAnalystTurn("how many tasks?", {
        path: HOST_CONTEXT_UNKNOWN_VALUE,
      }),
    ).toBe("how many tasks?");
  });

  it("leaves the message alone when the host never reported a page", () => {
    expect(
      groundAnalystTurn("how many tasks?", { path: UNKNOWN_PAGE_PATH }),
    ).toBe("how many tasks?");
  });
});
