import type { ConversationModes } from "../agent/conversation-modes.js";
import type { PendingRequest } from "../agent/permission-bus.js";
import type { PendingQuestion } from "../agent/question-bus.js";
import { getBuilderAvailable } from "../builder/capability.js";
import {
  type AskQuestionEventType,
  type ConversationListEventType,
  type ConversationSnapshotEventType,
  type ConversationSummaryType,
  EVENT_TYPES,
  type PermissionRequestEventType,
  type SettingsUpdateEventType,
} from "../protocol/events.js";
import type { Checkpoints } from "../checkpoints/checkpoints.js";
import { getProviderAvailability } from "../providers/registry.js";
import type { ConversationStore } from "../state/conversations.js";
import type {
  Notice,
  StoredConversationSummary,
  StoredMessage,
} from "../state/types.js";
import type { SocketSender } from "./host-socket-registry.js";
import type { SidecarServices } from "./services.js";

/** What a conversation's snapshot reads. */
export interface SnapshotServices {
  conversationStore: Pick<ConversationStore, "get">;
  checkpoints: Pick<Checkpoints, "forConversation">;
  conversationModes: Pick<ConversationModes, "describe">;
}

/** Audit-only records: they drive the activity log, not the visible transcript. */
const HIDDEN_ROLES: readonly StoredMessage["role"][] = ["permission"];
/** Fields of a stored message the chat never reads back. */
const AUDIT_ONLY_FIELDS: ReadonlyArray<keyof StoredMessage> = [
  "requestId",
  "kind",
  "alwaysAsk",
  "summary",
  "args",
  "requestedAtMs",
  "expiresAtMs",
  "feedback",
  "decidedBy",
  "decision",
];

function toSnapshotMessage(message: StoredMessage): StoredMessage {
  const copy = { ...message };
  for (const field of AUDIT_ONLY_FIELDS) delete copy[field];
  return copy;
}

export function buildSnapshotEvent(
  services: SnapshotServices,
  conversationId: string,
): ConversationSnapshotEventType | null {
  const conversation = services.conversationStore.get(conversationId);
  if (conversation === null) return null;
  return {
    type: EVENT_TYPES.CONVERSATION_SNAPSHOT,
    conversationId,
    messages: conversation.messages
      .filter((m) => !HIDDEN_ROLES.includes(m.role))
      .map(toSnapshotMessage),
    changeSets: services.checkpoints.forConversation(conversationId),
    mode: services.conversationModes.describe(conversationId),
    totalTokens: conversation.tokenUsage?.totalTokens ?? 0,
    cacheReadTokens: conversation.tokenUsage?.cacheReadTokens ?? 0,
    model: conversation.model,
  };
}

/**
 * The files the conversation's change sets still change, and those only its
 * undone sets touched: a chat whose every change was undone reads so in the
 * history rather than "no changes".
 */
function fileCounts(services: SidecarServices, conversationId: string) {
  const applied = new Set<string>();
  const undone = new Set<string>();
  for (const changeSet of services.checkpoints.forConversation(
    conversationId,
  )) {
    const paths = changeSet.state === "applied" ? applied : undone;
    for (const file of changeSet.files) paths.add(file.path);
  }
  for (const path of applied) undone.delete(path);
  return { filesChanged: applied.size, filesUndone: undone.size };
}

function enrichSummary(
  services: SidecarServices,
  summary: StoredConversationSummary,
): ConversationSummaryType {
  const { id } = summary;
  return {
    ...summary,
    ...fileCounts(services, id),
    isRunning: services.turns.isRunning(id),
    pendingApprovals: services.permissionBus.countPending(id),
    pendingQuestions: services.questionBus.countPending(id),
    generationMode: services.conversationModes.describe(id).generationMode,
  };
}

function listConversations(
  services: SidecarServices,
  viewerId: string | null,
): ConversationSummaryType[] {
  return services.conversationStore
    .list(viewerId)
    .map((summary) => enrichSummary(services, summary));
}

/** What the assistant is doing in the conversations a viewer may see. */
export interface ViewerActivity {
  workingConversations: number;
  pendingApprovals: number;
  pendingQuestions: number;
}

/**
 * The work and the waiting requests of the conversations `viewerId` may see,
 * read off the same summaries as their list: the tab's counts agree with the
 * list it shows, whoever else's turns run.
 */
export function viewerActivity(
  services: SidecarServices,
  viewerId: string | null,
): ViewerActivity {
  const conversations = listConversations(services, viewerId);
  const total = (count: (c: ConversationSummaryType) => number): number =>
    conversations.reduce((sum, c) => sum + count(c), 0);
  return {
    workingConversations: total((c) => (c.isRunning ? 1 : 0)),
    pendingApprovals: total((c) => c.pendingApprovals),
    pendingQuestions: total((c) => c.pendingQuestions),
  };
}

/** The conversations `viewerId` may see; see `isVisibleTo`. */
export function buildConversationListEvent(
  services: SidecarServices,
  viewerId: string | null,
): ConversationListEventType {
  return {
    type: EVENT_TYPES.CONVERSATION_LIST,
    conversations: listConversations(services, viewerId),
  };
}

/**
 * Keeps every open drawer's "Active" group live, and the launcher of every tab
 * whose panel is closed: those only said hello as a host. A socket that is both
 * gets the list once. Each socket gets the list of the actor it was told of.
 */
export function broadcastConversationList(services: SidecarServices): void {
  const byViewer = new Map<string | null, ConversationListEventType>();
  const listFor = (socket: SocketSender): ConversationListEventType => {
    const viewerId = services.viewers.get(socket) ?? null;
    const built =
      byViewer.get(viewerId) ?? buildConversationListEvent(services, viewerId);
    byViewer.set(viewerId, built);
    return built;
  };
  services.chatSocketRegistry.broadcastEach(listFor);
  services.hostSocketRegistry.broadcastEach(
    listFor,
    services.chatSocketRegistry.isChat,
  );
}

export function sendConversationMode(
  services: SidecarServices,
  conversationId: string,
): void {
  services.chatSocketRegistry.send(conversationId, {
    type: EVENT_TYPES.CONVERSATION_MODE,
    ...services.conversationModes.describe(conversationId),
  });
}

export function sendRulesState(
  services: SidecarServices,
  conversationId: string,
): void {
  services.chatSocketRegistry.send(conversationId, {
    type: EVENT_TYPES.RULES_STATE,
    conversationId,
    rules: services.permissionBus.listRules(conversationId),
  });
}

/** Stores a notice in the transcript and shows it live. */
export function emitNotice(
  services: SidecarServices,
  conversationId: string,
  notice: Notice,
): void {
  services.conversationStore.appendMessage(conversationId, {
    role: "notice",
    content: "",
    notice,
    timestampMs: notice.timestampMs,
  });
  services.chatSocketRegistry.send(conversationId, {
    type: EVENT_TYPES.NOTICE,
    conversationId,
    notice,
  });
}

export function buildPermissionRequestEvent(
  request: PendingRequest,
): PermissionRequestEventType {
  return { type: EVENT_TYPES.PERMISSION_REQUEST, ...request };
}

export function buildAskQuestionEvent(
  question: PendingQuestion,
): AskQuestionEventType {
  return { type: EVENT_TYPES.ASK_QUESTION, ...question };
}

export function buildSettingsUpdateEvent(
  services: Pick<SidecarServices, "settingsStore">,
): SettingsUpdateEventType {
  return {
    type: EVENT_TYPES.SETTINGS_UPDATE,
    settings: services.settingsStore.get(),
    builderAvailable: getBuilderAvailable(),
    providers: getProviderAvailability(),
  };
}
