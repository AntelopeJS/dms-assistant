import path from "node:path";
import type { BuilderError } from "@antelopejs/interface-dms-builder";
import { z } from "zod";
import { refusalMessage } from "../builder/refusal";
import { isSafe, type Verdict } from "./entry-verdict";
import {
  type Conflict,
  DMS_PATHS,
  type DeclaredConnection,
  type DmsKey,
  type HeldSetting,
  type Move,
} from "./builder-settings-plan";

function dmsPath(key: DmsKey): string {
  return DMS_PATHS[key].join(".");
}

function bindings(declared: readonly DeclaredConnection[]): string {
  return declared
    .map((connection) => `${connection.interface} from "${connection.source}"`)
    .join(" and ");
}

export function moveText(move: Move): string {
  if (move.kind === "setting") {
    const { legacyPath, key, value } = move.setting;
    return `${legacyPath} ${JSON.stringify(value)} from "${move.from}", as ${dmsPath(key)}`;
  }
  return move.alreadyOnDms
    ? `the connection "${move.id}" off "${move.from}", which already declared it the same way`
    : `the connection "${move.id}" from "${move.from}" (${bindings(move.declared)})`;
}

export function conflictText(dmsId: string, conflict: Conflict): string {
  if (conflict.kind === "connection") {
    return `"${conflict.from}" declares the connection "${conflict.id}" as ${bindings(conflict.legacy)}, and "${dmsId}" as ${bindings(conflict.dms)}. "${dmsId}" keeps its own; remove the one on "${conflict.from}".`;
  }
  const { legacyPath, key, value } = conflict.setting;
  return `"${conflict.from}" sets ${legacyPath} to ${JSON.stringify(value)}, and "${dmsId}" sets ${dmsPath(key)} to ${JSON.stringify(conflict.dms)}. "${dmsId}" keeps its value; remove ${legacyPath} from "${conflict.from}".`;
}

const FolderSchema = z.string();

export function byHandText(
  dmsId: string,
  { cwd, projectPath }: { cwd: string; projectPath: string },
  byHand: readonly HeldSetting[],
): string {
  const folders = byHand.map(
    ({ from, setting }) =>
      `${setting.legacyPath} on "${from}" names "${path.resolve(cwd, FolderSchema.parse(setting.value))}"`,
  );
  return `Not moved to the "${dmsId}" entry of antelope.config.ts: ${folders.join("; ")}. ajs runs from "${cwd}", outside the project folder "${projectPath}", and @antelopejs/dms resolves builder.projectRoot from the folder ajs runs from, so a relative value written now would name another folder. Set builder.projectRoot on "${dmsId}" to that folder by hand, as an absolute path.`;
}

/** What the move leaves for a person to move by hand, and every refusal that left it, each once. */
export interface NotMoved {
  refusals: BuilderError[];
  byHand: string[];
}

function refusalText(error: BuilderError): string {
  return error.code === "not_found"
    ? `antelope.config.ts writes no entry "${error.ref}" under modules where @antelopejs/dms can read it`
    : refusalMessage(error);
}

/** The one warning of what the move left for a person to move by hand. */
export function notMovedText(
  { dmsId, projectPath }: { dmsId: string | undefined; projectPath: string },
  { refusals, byHand }: NotMoved,
): string {
  const entry =
    dmsId === undefined ? "the @antelopejs/dms entry" : `the "${dmsId}" entry`;
  const messages = new Set(refusals.map(refusalText));
  const elsewhere = refusals.some(({ code }) => code === "unsupported")
    ? `Start ajs from the project folder "${projectPath}", or move these there by hand`
    : "Move these there by hand";
  return `Not moved to ${entry} of antelope.config.ts: ${[...messages].join("; ")}. ${elsewhere}: ${byHand.join("; ")}.`;
}

function listed(items: readonly string[]): string {
  return new Intl.ListFormat("en").format(items);
}

export function unreadEnvironmentsText(
  reason: string,
  ids: readonly string[],
): string {
  return `Could not read environments of antelope.config.ts: ${reason}. Check by hand the importOverrides that environments.<env>.modules gives ${listed(ids.map((id) => `"${id}"`))}. Move each catalog connection there to the @antelopejs/dms entry of the same environment.`;
}

const RESTART =
  " Start the project again for @antelopejs/dms to serve what moved.";

/**
 * One line per legacy entry the upgrade removes: safe to remove only when the move read all it
 * holds and nothing is left on it. On a start that wrote, it says to start the project again, since
 * @antelopejs/dms loaded the configuration before the move wrote it.
 */
export function verdictText(verdict: Verdict, wrote: boolean): string {
  const parts = [
    ...(verdict.unread.length > 0
      ? [
          `not safe to remove, the move could not read ${listed(verdict.unread)}`,
        ]
      : []),
    ...(verdict.left.length > 0
      ? [`${listed(verdict.left)} still here, move them before removing`]
      : []),
  ];
  const said = isSafe(verdict)
    ? "nothing left to move, safe to remove"
    : parts.join("; ");
  return `${verdict.id}: ${said}.${wrote ? RESTART : ""}`;
}
