import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import {
  MESSAGE_TYPES,
  PermissionRuleSchema,
} from "../../src/protocol/messages.js";
import { type JsonValue, JsonValueSchema } from "../../src/protocol/json.js";
import type { SidecarServices } from "../../src/server/services.js";
import type { ConversationStore } from "../../src/state/conversations.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  createCollector,
  openChat,
  requireValue,
  startWsHarness,
  type WireCollector,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

import {
  CAMILLE,
  CAMILLE_PAGE,
  CAMILLE_REPORT_PAGE,
  CAMILLE_TEXT,
  CONVERSATION,
  DANA,
  DANA_CONVERSATION,
  DANA_PAGE,
  EDITED_FILE,
  type Frame,
  type SentScope,
  QUESTION,
  REFUSAL,
  SCOPES,
  SETTLE_MS,
  TEST_TIMEOUT_MS,
  WAIT_MS,
  type World,
  type WorldKind,
} from "./chat-ownership-scopes.js";

interface Client {
  socket: WebSocket;
  frames: WireCollector;
}

/** The sockets of one scenario: each person's chat tab and dashboard host. */
interface Room {
  running: WsHarness;
  services: SidecarServices;
  camille: Client;
  camilleHost: Client;
  dana: Client;
  danaHost: Client;
}

let harness: WsHarness | undefined;
let sockets: WebSocket[] = [];
let settles = 0;

function transmit(socket: WebSocket, frame: Frame): void {
  socket.send(JSON.stringify(frame));
}

/**
 * Waits until the sidecar has handled every frame the client sent: the reply
 * to this echo, told apart from earlier ones by its payload, answers once the
 * earlier frames are dispatched, an undo or redo they started holds the
 * checkpoint lock until it is done, and the pause covers the socket delivery
 * of what they broadcast.
 */
async function settle(
  client: Client,
  services: SidecarServices,
): Promise<void> {
  settles += 1;
  const payload = `settled-${settles}`;
  transmit(client.socket, { type: "echo", payload });
  await client.frames.next(
    (msg) => msg.type === "echo_reply" && msg.payload === payload,
  );
  await services.checkpoints.flush();
  await new Promise((done) => setTimeout(done, SETTLE_MS));
}

async function connect(
  running: WsHarness,
  actor: typeof CAMILLE,
  role: "chat" | "host",
): Promise<Client> {
  const socket = await openChat(running.port);
  sockets.push(socket);
  const client = { socket, frames: createCollector(socket, WAIT_MS) };
  transmit(socket, { type: "actor", ...actor });
  transmit(socket, { type: "hello", role });
  if (role === "host") {
    transmit(socket, {
      type: "host_state_update",
      currentPage: { path: actor === CAMILLE ? CAMILLE_PAGE : DANA_PAGE },
    });
  }
  await settle(client, requireValue(running.bridge.services));
  return client;
}

async function openRoom(kind: WorldKind): Promise<Room> {
  const running = await startWsHarness({
    provider: CLAUDE_FIXTURE.name,
    withProject: kind === "settled",
    settings: { generationMode: "vibe" },
  });
  harness = running;
  return {
    running,
    services: requireValue(running.bridge.services),
    camille: await connect(running, CAMILLE, "chat"),
    camilleHost: await connect(running, CAMILLE, "host"),
    dana: await connect(running, DANA, "chat"),
    danaHost: await connect(running, DANA, "host"),
  };
}

function useScript(kind: "permission" | "edit"): void {
  CLAUDE_FIXTURE.use(kind);
}

async function buildPaused(room: Room): Promise<World> {
  useScript("permission");
  const { camille, services } = room;
  transmit(camille.socket, {
    type: "hello",
    role: "chat",
    conversationId: CONVERSATION,
  });
  const prompted = camille.frames.next(
    (msg) => msg.type === "permission_request",
  );
  transmit(camille.socket, {
    type: "user_message",
    conversationId: CONVERSATION,
    content: CAMILLE_TEXT,
  });
  const request = await prompted;
  transmit(camille.socket, {
    type: "queue_enqueue",
    conversationId: CONVERSATION,
    item: { id: "item-1", content: "then this" },
  });
  await camille.frames.next((msg) => msg.type === "queue_state");
  void services.questionBus.requestQuestion({
    conversationId: CONVERSATION,
    questions: [QUESTION],
  });
  const [question] =
    services.questionBus.getPendingForConversation(CONVERSATION);
  return {
    kind: "paused",
    requestId: String(request.requestId),
    ruleOption: PermissionRuleSchema.parse(request.ruleOptions?.[0]),
    ruleId: "none",
    questionId: requireValue(question).requestId,
    changeSetId: "none",
  };
}

async function prepareEditedFile(room: Room): Promise<void> {
  useScript("edit");
  const { projectRoot } = room.running;
  await mkdir(join(projectRoot, "src", "pages"), { recursive: true });
  await writeFile(join(projectRoot, EDITED_FILE), "<p>Hello</p>\n");
}

/** What one turn that edited `EDITED_FILE` left: its permission prompt and its change set's id. */
interface RecordedEdit {
  prompt: WireMessage;
  changeSetId: string;
}

/**
 * One turn of `client` on `conversationId`: what it asks, what its edit writes
 * to `EDITED_FILE`, and whether its permission prompt is allowed with a
 * standing rule, which spares the conversation's later turns their prompt.
 */
interface EditTurn {
  client: Client;
  conversationId: string;
  request: string;
  content: string;
  keepsRule: boolean;
}

/** Runs the turn, writing its edit while the turn waits on its permission prompt. */
async function recordEdit(
  room: Room,
  { client, conversationId, request, content, keepsRule }: EditTurn,
): Promise<RecordedEdit> {
  const earlier = new Set(client.frames.events);
  const next = (type: string) =>
    client.frames.next((msg) => msg.type === type && !earlier.has(msg));
  transmit(client.socket, { type: "hello", role: "chat", conversationId });
  transmit(client.socket, {
    type: "user_message",
    conversationId,
    content: request,
  });
  const prompt = await next("permission_request");
  await writeFile(join(room.running.projectRoot, EDITED_FILE), content);
  if (keepsRule) {
    answerPermission(
      client.socket,
      prompt,
      "allow_rule",
      requireValue(prompt.ruleOptions?.[0]),
    );
  } else {
    answerPermission(client.socket, prompt, "allow_once");
  }
  const changeSet = await next("change_set");
  await next("run_done");
  return {
    prompt,
    changeSetId: String(requireValue(changeSet.changeSet).id),
  };
}

async function buildSettled(room: Room): Promise<World> {
  await prepareEditedFile(room);
  const { prompt, changeSetId } = await recordEdit(room, {
    client: room.camille,
    conversationId: CONVERSATION,
    request: CAMILLE_TEXT,
    content: "<p>Hello world</p>\n",
    keepsRule: true,
  });
  return {
    kind: "settled",
    requestId: "none",
    ruleOption: PermissionRuleSchema.parse(prompt.ruleOptions?.[0]),
    ruleId: requireValue(room.services.permissionBus.listRules(CONVERSATION)[0])
      .id,
    questionId: "none",
    changeSetId,
  };
}

function changeSetStates(room: Room, conversationId: string): string[] {
  return room.services.checkpoints
    .forConversation(conversationId)
    .map((set) => set.state);
}

/**
 * Why the conversation is closed, or null. Read through `in` so the check
 * also runs on the code before conversations could be closed.
 */
function closureOf(store: ConversationStore): string | null {
  return "closure" in store ? store.closure(CONVERSATION) : null;
}

/** What Camille's pending navigation has received so far. */
interface Waiters {
  landed: boolean;
  reported: boolean;
}

/** Camille's agent waits for her host to land on one page and to report the blocks of another. */
function watchNavigation(services: SidecarServices, waiters: Waiters): void {
  const { navigationCompleter } = services;
  void navigationCompleter
    .waitFor(CAMILLE.userId, CAMILLE_PAGE, WAIT_MS * 3)
    .then((landing) => {
      waiters.landed = landing !== null;
    });
  void navigationCompleter
    .waitFor(CAMILLE.userId, CAMILLE_REPORT_PAGE, WAIT_MS * 3)
    .then(async (landing) => {
      waiters.reported = (await landing?.blocks) != null;
    });
  navigationCompleter.complete(CAMILLE.userId, CAMILLE_REPORT_PAGE, {
    blocksWithinMs: WAIT_MS,
  });
}

/** Everything the conversation's owner can observe about it, for a before and after comparison. */
async function observe(room: Room, waiter: Waiters): Promise<JsonValue> {
  const { services, running } = room;
  await services.conversationStore.flush();
  return JsonValueSchema.parse(
    JSON.parse(
      JSON.stringify({
        stored: running.conversationStore.get(CONVERSATION),
        closure: closureOf(running.conversationStore),
        listedForCamille: running.conversationStore
          .list(CAMILLE.userId)
          .map((c) => c.id),
        queue: services.pendingQueue.get(CONVERSATION),
        rules: services.permissionBus.listRules(CONVERSATION),
        permissionPrompts:
          services.permissionBus.getPendingForConversation(CONVERSATION),
        questions: services.questionBus.getPendingForConversation(CONVERSATION),
        modes: services.conversationModes.describe(CONVERSATION),
        turn: services.turns.isRunning(CONVERSATION),
        autoFixStopped: services.turns.isAutoFixStopped(CONVERSATION),
        cameillePage: services.hostState.getCurrentPage(CAMILLE.userId),
        changeSets: services.checkpoints
          .forConversation(CONVERSATION)
          .map((set) => ({ id: set.id, state: set.state })),
        navigationLanded: waiter.landed,
        blocksReported: waiter.reported,
      }),
    ),
  );
}

/** A frame that names the conversation, or something only its owner was told. */
function mentionsOwnerData(frame: WireMessage, world: World): boolean {
  const text = JSON.stringify(frame);
  return [
    CONVERSATION,
    CAMILLE_TEXT,
    world.requestId,
    world.questionId,
    world.changeSetId,
  ]
    .filter((secret) => secret !== "none")
    .some((secret) => text.includes(secret));
}

function isRefusal(frame: WireMessage): boolean {
  return frame.type === "run_error" && frame.error === REFUSAL;
}

async function checkRequest(
  kind: WorldKind,
  framesOf: (world: World) => Frame[],
): Promise<void> {
  const room = await openRoom(kind);
  const world =
    kind === "paused" ? await buildPaused(room) : await buildSettled(room);
  const waiter: Waiters = { landed: false, reported: false };
  watchNavigation(room.services, waiter);
  transmit(room.camilleHost.socket, {
    type: "host_state_update",
    currentPage: { path: CAMILLE_PAGE },
  });
  await settle(room.camilleHost, room.services);
  for (const frame of framesOf(world)) {
    const before = await observe(room, waiter);
    const seen = {
      dana: room.dana.frames.events.length,
      camille: room.camille.frames.events.length,
      camilleHost: room.camilleHost.frames.events.length,
    };
    transmit(room.dana.socket, frame);
    await settle(room.dana, room.services);
    const toDana = room.dana.frames.events
      .slice(seen.dana)
      .filter((msg) => msg.type !== "echo_reply");
    const asked = JSON.stringify(frame);
    expect(
      toDana.filter((msg) => !isRefusal(msg) && mentionsOwnerData(msg, world)),
      `Dana's reply to ${asked} tells her about Camille's conversation`,
    ).toEqual([]);
    expect(
      room.camille.frames.events.slice(seen.camille),
      `${asked} reaches Camille's chat`,
    ).toEqual([]);
    expect(
      room.camilleHost.frames.events.slice(seen.camilleHost),
      `${asked} reaches Camille's host`,
    ).toEqual([]);
    expect(
      await observe(room, waiter),
      `${asked} changes Camille's conversation`,
    ).toEqual(before);
  }
}

describe("a chat request from another person (formal target: chat requests honouring the conversation owner)", () => {
  afterEach(async () => {
    for (const socket of sockets) socket.close();
    sockets = [];
    await harness?.close();
    harness = undefined;
  });

  it("classifies every message type the protocol defines", () => {
    const classified = Object.keys(SCOPES).sort();
    const defined = Object.values(MESSAGE_TYPES)
      .filter((type) => type !== MESSAGE_TYPES.ECHO_REPLY)
      .sort();
    expect(classified).toEqual(defined);
  });

  it(
    "lets the owner undo her own change set (fails a change_set_action check that refuses everyone)",
    async () => {
      const room = await openRoom("settled");
      const world = await buildSettled(room);
      const undone = room.camille.frames.next(
        (msg) =>
          msg.type === "change_set" &&
          JSON.stringify(msg.changeSet).includes('"state":"undone"'),
      );
      transmit(room.camille.socket, {
        type: "change_set_action",
        changeSetId: world.changeSetId,
        action: "undo",
        conversationId: CONVERSATION,
      });
      await undone;
      expect(changeSetStates(room, CONVERSATION)).toEqual(["undone"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "undoes with the later change sets only those of Dana's conversation (fails an undo that takes every later set, or none)",
    async () => {
      const room = await openRoom("settled");
      await prepareEditedFile(room);
      const danaTurn = {
        client: room.dana,
        conversationId: DANA_CONVERSATION,
        request: "dana's request",
        keepsRule: false,
      };
      const first = await recordEdit(room, {
        ...danaTurn,
        content: "<p>Hello Dana</p>\n",
      });
      await recordEdit(room, {
        client: room.camille,
        conversationId: CONVERSATION,
        request: CAMILLE_TEXT,
        content: "<p>Hello Dana and Camille</p>\n",
        keepsRule: false,
      });
      await recordEdit(room, {
        ...danaTurn,
        content: "<p>Hello again Dana and Camille</p>\n",
      });
      transmit(room.dana.socket, {
        type: "change_set_action",
        changeSetId: first.changeSetId,
        action: "undo",
        includeLater: true,
        conversationId: DANA_CONVERSATION,
      });
      await settle(room.dana, room.services);
      expect(changeSetStates(room, DANA_CONVERSATION)).toEqual([
        "undone",
        "undone",
      ]);
      expect(changeSetStates(room, CONVERSATION)).toEqual(["applied"]);
    },
    TEST_TIMEOUT_MS * 2,
  );

  const sent = Object.entries(SCOPES).flatMap(([type, scope]) =>
    scope.kind === "send" ? [[type, scope] as const] : [],
  );

  const run = (_type: string, scope: SentScope) =>
    checkRequest(scope.world, scope.frames);

  it.each(sent.filter(([, scope]) => scope.defect === undefined))(
    "%s changes nothing of Camille's, tells Dana nothing and reaches no other host (fails a handler that skips the ownership check)",
    run,
    TEST_TIMEOUT_MS,
  );

  it.fails.each(sent.filter(([, scope]) => scope.defect !== undefined))(
    "%s changes nothing of Camille's, tells Dana nothing and reaches no other host (known defect, expected to fail)",
    run,
    TEST_TIMEOUT_MS,
  );
});
