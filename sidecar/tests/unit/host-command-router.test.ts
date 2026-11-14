import { describe, expect, it, vi } from "vitest";
import {
  type AnyServerEventType,
  EVENT_TYPES,
} from "../../src/protocol/events.js";
import { createHostCommandRouter } from "../../src/server/host-command-router.js";
import {
  createHostSocketRegistry,
  type SocketSender,
} from "../../src/server/host-socket-registry.js";
import { createChatSocketRegistry } from "../../src/server/chat-socket-registry.js";

const FIRST_TAB_CONVERSATION = "conv-first-tab";
const SECOND_TAB_CONVERSATION = "conv-second-tab";
const CAMILLE = "u-camille";
const DANA = "u-dana";
const NAVIGATE_EVENT: AnyServerEventType = {
  type: EVENT_TYPES.HOST_COMMAND_NAVIGATE,
  path: "/dashboard/settings",
};

interface Tab {
  socket: SocketSender;
  send: ReturnType<typeof vi.fn>;
}

function buildTab(): Tab {
  const send = vi.fn();
  return { socket: { send }, send };
}

/** Every conversation belongs to Camille, unless `owners` says otherwise. */
function ownedBy(owners: Record<string, string> = {}) {
  return {
    get: (conversationId: string) => ({
      messages: [],
      createdAtMs: 0,
      updatedAtMs: 0,
      ownerId: Object.hasOwn(owners, conversationId)
        ? owners[conversationId]
        : CAMILLE,
    }),
  };
}

function openTwoTabs(secondTabOwner = CAMILLE) {
  const hosts = createHostSocketRegistry();
  const chats = createChatSocketRegistry();
  const viewers = new WeakMap<SocketSender, string>();
  const first = buildTab();
  const second = buildTab();
  viewers.set(first.socket, CAMILLE);
  viewers.set(second.socket, secondTabOwner);
  hosts.set(first.socket);
  chats.set(FIRST_TAB_CONVERSATION, first.socket);
  hosts.set(second.socket);
  chats.set(SECOND_TAB_CONVERSATION, second.socket);
  return {
    hosts,
    chats,
    first,
    second,
    route: createHostCommandRouter({
      hosts,
      chats,
      conversations: ownedBy({ [SECOND_TAB_CONVERSATION]: secondTabOwner }),
      viewers,
    }),
  };
}

describe("createHostCommandRouter", () => {
  it("sends a conversation's command to the tab carrying it, not the latest host", () => {
    const { first, second, route } = openTwoTabs();
    route(FIRST_TAB_CONVERSATION)(NAVIGATE_EVENT);
    expect(first.send).toHaveBeenCalledWith(JSON.stringify(NAVIGATE_EVENT));
    expect(second.send).not.toHaveBeenCalled();
  });

  it("falls back to the latest host once the conversation's tab is gone", () => {
    const { hosts, chats, first, second, route } = openTwoTabs();
    hosts.clear(first.socket);
    chats.clear(first.socket);
    route(FIRST_TAB_CONVERSATION)(NAVIGATE_EVENT);
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).toHaveBeenCalledWith(JSON.stringify(NAVIGATE_EVENT));
  });

  it("never falls back to another person's host (fails a fallback to the latest host of any user)", () => {
    const { hosts, chats, first, second, route } = openTwoTabs(DANA);
    hosts.clear(first.socket);
    chats.clear(first.socket);
    route(FIRST_TAB_CONVERSATION)(NAVIGATE_EVENT);
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).not.toHaveBeenCalled();
  });

  it("falls back to the latest host for a conversation no tab carries", () => {
    const { first, second, route } = openTwoTabs();
    route("conv-unopened")(NAVIGATE_EVENT);
    expect(first.send).not.toHaveBeenCalled();
    expect(second.send).toHaveBeenCalledTimes(1);
  });
});
