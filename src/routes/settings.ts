import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Put,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import {
  asFormValues,
  nestDefaultModes,
  scopeFromSafeMode,
  type SettingsBody,
  withNumbersAs,
} from "../sidecar/settings-values";
import { OWNER_UI_HEADER, outsideOwnerUi } from "./owner-ui";
import { relay } from "./sidecar-results";
import { SETTINGS_ANSWER } from "./sidecar-answers";

const SETTINGS_PATH = "/settings";

/** What the form reads but never writes: the sidecar's capabilities. */
const READ_ONLY_SETTINGS = [
  "builderAvailable",
  "providers",
  "alwaysAskDeletions",
  "defaults",
] as const;

/** Deletions always ask: the form shows it as a locked switch. */
const ALWAYS_ASK_DELETIONS = true;

/**
 * The sidecar settings an owner's request may write without the assistant UI's
 * header. Every other key of an update is a guard rail (the default approval
 * modes, the scope, the asks, local skills), and so is a key the sidecar
 * adds later.
 */
const FREE_SETTINGS: ReadonlySet<string> = new Set([
  "provider",
  "thinking",
  "claudeModel",
  "requestTimeoutMinutes",
  "notifyRequests",
  "checkpointRetentionDays",
]);

function writesGuardRail(update: SettingsBody): boolean {
  return Object.keys(update).some((key) => !FREE_SETTINGS.has(key));
}

/** The flat settings object the form reads, with the read-only capabilities. */
function formSettings(settings: SettingsBody): SettingsBody {
  return {
    ...asFormValues(settings),
    alwaysAskDeletions: ALWAYS_ASK_DELETIONS,
  };
}

/** The partial update the sidecar takes: writable keys, numbers as numbers. */
function sidecarUpdate(body: SettingsBody): SettingsBody {
  const update = nestDefaultModes(
    scopeFromSafeMode(withNumbersAs(body, Number)),
  );
  for (const key of READ_ONLY_SETTINGS) delete update[key];
  return update;
}

/**
 * The settings route. Reads answer the flat settings plus what this install
 * can do; writes forward the one field an instant save sends. A write that
 * holds a guard rail answers the assistant's own UI alone (403 otherwise,
 * nothing sent to the sidecar), because the settings form's save, like any form
 * block of a page the assistant built, cannot send the header. A refusal
 * (400, 403) or an unreachable sidecar (503) answers `{ message }`, so the
 * form keeps the confirmed value and says "Not saved".
 */
@AuthOwnerOnly()
export class AISettingsController extends Controller(ROUTE_PREFIX) {
  @Get(SETTINGS_PATH)
  getSettings(): Promise<SettingsBody | HTTPResult> {
    return relay(SETTINGS_PATH, SETTINGS_ANSWER, formSettings);
  }

  @Put(SETTINGS_PATH)
  async updateSettings(
    @JSONBody() body: SettingsBody | undefined,
    @Parameter(OWNER_UI_HEADER, "header") marker: string | undefined,
  ): Promise<SettingsBody | HTTPResult> {
    const update = sidecarUpdate(body ?? {});
    const refused = writesGuardRail(update)
      ? outsideOwnerUi(marker)
      : undefined;
    if (refused) return refused;
    return relay(SETTINGS_PATH, SETTINGS_ANSWER, formSettings, {
      method: "PUT",
      body: update,
    });
  }
}
