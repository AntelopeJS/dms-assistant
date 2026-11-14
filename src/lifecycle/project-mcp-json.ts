import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModuleInfo, ListModules } from "@antelopejs/interface-core/modules";
import { z } from "zod";
import {
  DMS_MCP_LAUNCHER,
  DMS_MCP_SERVER_ENTRY,
  DMS_MCP_SERVER_KEY,
  DMS_PACKAGE_NAME,
  MCP_JSON_INDENT,
  MCP_JSON_PRINT_WIDTH,
  PROJECT_MCP_JSON_FILE_NAME,
} from "../constants/project-mcp";
import {
  MODULE_ROOTS_TIMEOUT_MS,
  SIDECAR_LOG_PREFIX,
} from "../constants/sidecar";

const JsonObjectSchema = z.record(z.string(), z.json());
type JsonObject = z.infer<typeof JsonObjectSchema>;

type McpJsonState =
  | { kind: "missing" }
  | { kind: "unusable" }
  | { kind: "present"; file: JsonObject; servers: JsonObject };

const MissingFileSchema = z.object({ code: z.literal("ENOENT") });
const PackageNameSchema = z.object({ name: z.string() });

/**
 * The `mcp` config `@antelopejs/dms` accepts. Any other shape turns its MCP
 * server off, so it writes nothing to `.mcp.json`.
 */
const DmsConfigSchema = z.looseObject({
  mcp: z
    .object({
      enabled: z.boolean().optional(),
      access: z.enum(["safe", "full"]).optional(),
      mcpJson: z.boolean().optional(),
      backendUrl: z.string().optional(),
    })
    .strict()
    .optional(),
});

const EXPANDED_PRIMITIVE_ARRAY =
  /\[\n((?: *(?:"(?:[^"\\\n]|\\.)*"|-?\d[\d.eE+-]*|true|false|null),?\n)+) *\]/g;
const ZERO_WIDTH = /^[\p{M}\p{Cc}​-‏⁠﻿]$/u;
const DOUBLE_WIDTH =
  /^[\p{Extended_Pictographic}ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]$/u;

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (ZERO_WIDTH.test(char)) continue;
    width += DOUBLE_WIDTH.test(char) ? 2 : 1;
  }
  return width;
}

/**
 * Serializes `.mcp.json` as `@antelopejs/dms` does and as oxfmt and Prettier
 * print it: a two-space indent, and an array of plain values on one line when
 * that line fits the print width.
 */
function formatMcpJson(value: JsonObject): string {
  const expanded = JSON.stringify(value, null, MCP_JSON_INDENT);
  return expanded.replace(
    EXPANDED_PRIMITIVE_ARRAY,
    (match: string, body: string, offset: number) => {
      const items = body
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => line.trim().replace(/,$/, ""));
      const inline = `[${items.join(", ")}]`;
      const lineStart = expanded.lastIndexOf("\n", offset) + 1;
      const end = offset + match.length;
      const lineEnd = expanded.indexOf("\n", end);
      const line =
        expanded.slice(lineStart, offset) +
        inline +
        expanded.slice(end, lineEnd === -1 ? expanded.length : lineEnd);
      return displayWidth(line) <= MCP_JSON_PRINT_WIDTH ? inline : match;
    },
  );
}

async function isDmsPackage(localPath: string): Promise<boolean> {
  try {
    const text = await readFile(path.join(localPath, "package.json"), "utf8");
    const manifest = PackageNameSchema.safeParse(JSON.parse(text));
    return manifest.success && manifest.data.name === DMS_PACKAGE_NAME;
  } catch {
    return false;
  }
}

async function readDmsWritesMcpJson(): Promise<boolean> {
  for (const id of await ListModules()) {
    const info = await GetModuleInfo(id);
    if (!(await isDmsPackage(info.localPath))) continue;
    const config = DmsConfigSchema.safeParse(info.config ?? {});
    const mcp = config.data?.mcp ?? {};
    return config.success && mcp.enabled !== false && mcp.mcpJson !== false;
  }
  return false;
}

function dmsWritesMcpJson(): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), MODULE_ROOTS_TIMEOUT_MS);
    readDmsWritesMcpJson().then(
      (writes) => {
        clearTimeout(timer);
        resolve(writes);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

async function isLauncherWritten(projectRoot: string): Promise<boolean> {
  try {
    return (await stat(path.join(projectRoot, DMS_MCP_LAUNCHER))).isFile();
  } catch {
    return false;
  }
}

async function readMcpJson(filePath: string): Promise<McpJsonState> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    return MissingFileSchema.safeParse(error).success
      ? { kind: "missing" }
      : { kind: "unusable" };
  }
  try {
    const file = JsonObjectSchema.safeParse(JSON.parse(text));
    const servers = JsonObjectSchema.optional().safeParse(
      file.data?.mcpServers,
    );
    if (!file.success || !servers.success) return { kind: "unusable" };
    return { kind: "present", file: file.data, servers: servers.data ?? {} };
  } catch {
    return { kind: "unusable" };
  }
}

async function syncFile(projectRoot: string, addsDms: boolean): Promise<void> {
  const filePath = path.join(projectRoot, PROJECT_MCP_JSON_FILE_NAME);
  const state = await readMcpJson(filePath);
  if (state.kind === "unusable") {
    Logging.Warn(
      `${SIDECAR_LOG_PREFIX} ${PROJECT_MCP_JSON_FILE_NAME} is not a JSON object with an object of servers, so it was left as it is.`,
    );
    return;
  }
  const file = state.kind === "present" ? state.file : {};
  const servers = state.kind === "present" ? state.servers : {};
  if (!addsDms || Object.hasOwn(servers, DMS_MCP_SERVER_KEY)) return;
  const next = {
    ...file,
    mcpServers: { ...servers, [DMS_MCP_SERVER_KEY]: DMS_MCP_SERVER_ENTRY },
  };
  await writeFile(filePath, `${formatMcpJson(next)}\n`);
  Logging.Info(
    `${SIDECAR_LOG_PREFIX} ${PROJECT_MCP_JSON_FILE_NAME}: added the ${DMS_MCP_SERVER_KEY} server.`,
  );
}

/**
 * Adds the `dms` server of `@antelopejs/dms` to the project's `.mcp.json`
 * when that module writes one, its launcher is there and the server is
 * missing. Every other server and key is kept as it is, and a file that
 * already holds a `dms` server is not written. A file that is not a JSON
 * object with an object of servers is left alone with a warning. Running it
 * again changes nothing, so it runs on every start.
 */
export async function syncProjectMcpJson(projectRoot: string): Promise<void> {
  try {
    const addsDms =
      (await dmsWritesMcpJson()) && (await isLauncherWritten(projectRoot));
    await syncFile(projectRoot, addsDms);
  } catch (error) {
    Logging.Warn(
      `${SIDECAR_LOG_PREFIX} ${PROJECT_MCP_JSON_FILE_NAME} could not be updated:`,
      error,
    );
  }
}
