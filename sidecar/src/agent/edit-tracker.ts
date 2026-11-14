import { readStringArg, type ToolArgs } from "./edit-targets.js";

export const EDIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
]);

export function extractEditedFilePath(args: ToolArgs): string | undefined {
  const value = readStringArg(args, "file_path");
  return value !== undefined && value.length > 0 ? value : undefined;
}

export interface EditTracker {
  record(conversationId: string, filePath: string): void;
  getEditedFiles(conversationId: string): string[];
  clear(conversationId: string): void;
}

export function createEditTracker(): EditTracker {
  const byConversation = new Map<string, string[]>();
  return {
    record: (conversationId, filePath) => {
      const list = byConversation.get(conversationId) ?? [];
      list.push(filePath);
      byConversation.set(conversationId, list);
    },
    getEditedFiles: (conversationId) => [
      ...(byConversation.get(conversationId) ?? []),
    ],
    clear: (conversationId) => {
      byConversation.delete(conversationId);
    },
  };
}
