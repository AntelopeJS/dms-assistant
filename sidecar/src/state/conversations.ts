import { DELETED_ID_RETENTION_MS } from "../constants/state.js";
import type { Store } from "./store.js";
import type { ChatMode, GenerationMode } from "./settings-types.js";
import {
  EMPTY_TOKEN_USAGE,
  type ProviderName,
  type StoredConversation,
  type StoredConversationSummary,
  type StoredMessage,
  type StoredState,
  type TokenUsage,
} from "./types.js";

export interface CreateConversationStoreOptions {
  store: Store;
}

export interface ConversationEntry {
  id: string;
  title: string;
  conversation: StoredConversation;
}

/** The per-conversation approval mode and scope, both optional on update. */
export interface ConversationModesPatch {
  mode?: ChatMode;
  generationMode?: GenerationMode;
}

type StoredMessagePatch = Partial<StoredMessage>;

/** Why a conversation id takes no more writes: set aside when the store was read, or deleted. */
export type ConversationClosure = "set_aside" | "deleted";

/** What a chat is told when it opens or writes to a closed conversation. */
export const CLOSED_CONVERSATION_MESSAGES: Record<ConversationClosure, string> =
  {
    set_aside:
      "This conversation was saved by another version of the assistant and cannot be continued. Start a new conversation.",
    deleted: "This conversation was deleted. Start a new conversation.",
  };

export interface ConversationStore {
  get(conversationId: string): StoredConversation | null;
  /**
   * Why the id is closed, or null when it is open. A closed id is never
   * reused: every write under it is dropped, so a set-aside record and its
   * owner stay as they were, and a deleted conversation stays deleted.
   */
  closure(conversationId: string): ConversationClosure | null;
  appendMessage(conversationId: string, message: StoredMessage): void;
  /**
   * Merges `patch` into every stored message `matches` accepts. Used to stamp
   * an outcome or a change set on calls already persisted.
   */
  patchMessages(
    conversationId: string,
    matches: (message: StoredMessage) => boolean,
    patch: StoredMessagePatch,
  ): void;
  /** Records which backend produced the transcript. */
  markProvider(conversationId: string, provider: ProviderName): void;
  /** Records the model that answered last. */
  markModel(conversationId: string, model: string): void;
  /** Adds one turn's usage to the conversation total. */
  addTokenUsage(conversationId: string, usage: TokenUsage): void;
  /** Adds one turn's usage to the total and to the dated usage log. */
  recordTurnUsage(
    conversationId: string,
    usage: TokenUsage,
    timestampMs: number,
  ): void;
  setModes(conversationId: string, patch: ConversationModesPatch): void;
  /**
   * Records `ownerId` as the conversation's owner, creating the conversation
   * when it is new. A conversation that already has an owner or messages keeps
   * what it has.
   */
  claim(conversationId: string, ownerId: string): void;
  /** The conversations `viewerId` may see, newest first; see `isVisibleTo`. */
  list(viewerId: string | null): StoredConversationSummary[];
  entries(): ConversationEntry[];
  delete(conversationId: string): void;
  loadFromDisk(): Promise<void>;
  flush(): Promise<void>;
}

const TITLE_MAX_LENGTH = 60;
const TITLE_FALLBACK = "New conversation";

interface CacheState {
  store: Store;
  cache: Map<string, StoredConversation>;
  setAside: ReadonlySet<string>;
  /** When each deleted conversation was deleted; see `DELETED_ID_RETENTION_MS`. */
  deleted: Map<string, number>;
}

function buildEmptyConversation(nowMs: number): StoredConversation {
  return {
    messages: [],
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function snapshotState(state: CacheState): StoredState {
  const snapshot: StoredState = {
    conversations: Object.fromEntries(state.cache),
  };
  if (state.deleted.size > 0) {
    snapshot.deleted = Object.fromEntries(state.deleted);
  }
  return snapshot;
}

function closureOf(
  state: CacheState,
  conversationId: string,
): ConversationClosure | null {
  if (state.setAside.has(conversationId)) return "set_aside";
  if (state.deleted.has(conversationId)) return "deleted";
  return null;
}

/**
 * Forgets the deletions older than the retention: by then no turn of theirs
 * runs, and an id is a random UUID that only its own browser still holds.
 */
function pruneDeleted(state: CacheState, nowMs: number): void {
  for (const [id, deletedAtMs] of state.deleted) {
    if (nowMs - deletedAtMs > DELETED_ID_RETENTION_MS) state.deleted.delete(id);
  }
}

function persistCache(state: CacheState): void {
  state.store.write(snapshotState(state));
}

function getConversation(
  state: CacheState,
  conversationId: string,
): StoredConversation | null {
  return state.cache.get(conversationId) ?? null;
}

/** The conversation under `conversationId`, created when new; null for a closed id. */
function ensureConversation(
  state: CacheState,
  conversationId: string,
): StoredConversation | null {
  const existing = state.cache.get(conversationId);
  if (existing !== undefined) return existing;
  if (closureOf(state, conversationId) !== null) return null;
  const created = buildEmptyConversation(Date.now());
  state.cache.set(conversationId, created);
  return created;
}

function appendToConversation(
  state: CacheState,
  conversationId: string,
  message: StoredMessage,
): void {
  const conversation = ensureConversation(state, conversationId);
  if (conversation === null) return;
  conversation.messages.push(message);
  conversation.updatedAtMs = message.timestampMs;
  persistCache(state);
}

function patchMessages(
  state: CacheState,
  conversationId: string,
  matches: (message: StoredMessage) => boolean,
  patch: StoredMessagePatch,
): void {
  const conversation = state.cache.get(conversationId);
  if (conversation === undefined) return;
  let isChanged = false;
  for (const message of conversation.messages) {
    if (!matches(message)) continue;
    Object.assign(message, patch);
    isChanged = true;
  }
  if (isChanged) persistCache(state);
}

function markProvider(
  state: CacheState,
  conversationId: string,
  provider: ProviderName,
): void {
  const conversation = ensureConversation(state, conversationId);
  if (conversation === null) return;
  if (conversation.provider === provider) return;
  conversation.provider = provider;
  persistCache(state);
}

function markModel(
  state: CacheState,
  conversationId: string,
  model: string,
): void {
  const conversation = ensureConversation(state, conversationId);
  if (conversation === null) return;
  if (conversation.model === model) return;
  conversation.model = model;
  persistCache(state);
}

function sumUsage(current: TokenUsage, usage: TokenUsage): TokenUsage {
  return {
    inputTokens: current.inputTokens + usage.inputTokens,
    outputTokens: current.outputTokens + usage.outputTokens,
    totalTokens: current.totalTokens + usage.totalTokens,
  };
}

function addTokenUsage(
  state: CacheState,
  conversationId: string,
  usage: TokenUsage,
): void {
  const conversation = ensureConversation(state, conversationId);
  if (conversation === null) return;
  conversation.tokenUsage = sumUsage(
    conversation.tokenUsage ?? EMPTY_TOKEN_USAGE,
    usage,
  );
  persistCache(state);
}

function recordTurnUsage(
  state: CacheState,
  conversationId: string,
  usage: TokenUsage,
  timestampMs: number,
): void {
  const conversation = ensureConversation(state, conversationId);
  if (conversation === null) return;
  conversation.usageLog = [
    ...(conversation.usageLog ?? []),
    { ...usage, timestampMs },
  ];
  addTokenUsage(state, conversationId, usage);
}

function setModes(
  state: CacheState,
  conversationId: string,
  patch: ConversationModesPatch,
): void {
  const conversation = ensureConversation(state, conversationId);
  if (conversation === null) return;
  if (patch.mode !== undefined) conversation.mode = patch.mode;
  if (patch.generationMode !== undefined) {
    conversation.generationMode = patch.generationMode;
  }
  persistCache(state);
}

function claimConversation(
  state: CacheState,
  conversationId: string,
  ownerId: string,
): void {
  const conversation = ensureConversation(state, conversationId);
  if (conversation === null) return;
  if (conversation.ownerId !== undefined) return;
  if (conversation.messages.length > 0) return;
  conversation.ownerId = ownerId;
  persistCache(state);
}

/**
 * Whether `viewerId` (null: a connection that named no actor) may see and
 * use the conversation: its owner. A record with no owner is open to anyone
 * while it is empty, so its first asker can claim it. Once it holds messages
 * only a connection that named no actor may use it; the backend names the
 * actor first on every socket it opens, so in production none does.
 */
export function isVisibleTo(
  conversation: StoredConversation,
  viewerId: string | null,
): boolean {
  if (conversation.ownerId !== undefined) {
    return conversation.ownerId === viewerId;
  }
  return conversation.messages.length === 0 || viewerId === null;
}

function deriveTitle(conversation: StoredConversation): string {
  const firstUser = conversation.messages.find((m) => m.role === "user");
  if (firstUser === undefined) return TITLE_FALLBACK;
  return truncateTitle(firstUser.content);
}

/** A request shortened to a title: one line, at most TITLE_MAX_LENGTH chars. */
export function truncateTitle(content: string): string {
  const text = content.trim().replaceAll(/\s+/g, " ");
  if (text.length === 0) return TITLE_FALLBACK;
  if (text.length <= TITLE_MAX_LENGTH) return text;
  return `${text.slice(0, TITLE_MAX_LENGTH).trimEnd()}…`;
}

function summarize(
  id: string,
  conversation: StoredConversation,
): StoredConversationSummary {
  return {
    id,
    title: deriveTitle(conversation),
    createdAtMs: conversation.createdAtMs,
    updatedAtMs: conversation.updatedAtMs,
    messageCount: conversation.messages.length,
    provider: conversation.provider,
    totalTokens: conversation.tokenUsage?.totalTokens ?? 0,
  };
}

function listConversations(
  state: CacheState,
  viewerId: string | null,
): StoredConversationSummary[] {
  const summaries = [...state.cache]
    .filter(([, conversation]) => isVisibleTo(conversation, viewerId))
    .map(([id, conversation]) => summarize(id, conversation));
  summaries.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return summaries;
}

function listEntries(state: CacheState): ConversationEntry[] {
  return [...state.cache].map(([id, conversation]) => ({
    id,
    title: deriveTitle(conversation),
    conversation,
  }));
}

function deleteConversation(state: CacheState, conversationId: string): void {
  if (!state.cache.delete(conversationId)) return;
  const nowMs = Date.now();
  state.deleted.set(conversationId, nowMs);
  pruneDeleted(state, nowMs);
  persistCache(state);
}

async function loadCacheFromDisk(state: CacheState): Promise<void> {
  const stored = await state.store.read();
  state.cache.clear();
  for (const [id, conv] of Object.entries(stored.conversations)) {
    state.cache.set(id, conv);
  }
  state.setAside = new Set(state.store.setAsideIds());
  state.deleted = new Map(Object.entries(stored.deleted ?? {}));
  pruneDeleted(state, Date.now());
}

export function createConversationStore(
  options: CreateConversationStoreOptions,
): ConversationStore {
  const state: CacheState = {
    store: options.store,
    cache: new Map(),
    setAside: new Set(),
    deleted: new Map(),
  };
  return {
    get: (id) => getConversation(state, id),
    closure: (id) => closureOf(state, id),
    appendMessage: (id, message) => appendToConversation(state, id, message),
    patchMessages: (id, matches, patch) =>
      patchMessages(state, id, matches, patch),
    markProvider: (id, provider) => markProvider(state, id, provider),
    markModel: (id, model) => markModel(state, id, model),
    addTokenUsage: (id, usage) => addTokenUsage(state, id, usage),
    recordTurnUsage: (id, usage, timestampMs) =>
      recordTurnUsage(state, id, usage, timestampMs),
    setModes: (id, patch) => setModes(state, id, patch),
    claim: (id, ownerId) => claimConversation(state, id, ownerId),
    list: (viewerId) => listConversations(state, viewerId),
    entries: () => listEntries(state),
    delete: (id) => deleteConversation(state, id),
    loadFromDisk: () => loadCacheFromDisk(state),
    flush: () => state.store.flush(),
  };
}
