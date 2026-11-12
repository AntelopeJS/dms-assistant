import { z } from "zod";
import type { JsonBody } from "./json-body";

/** The sidecar's settings, by key. */
export type SettingsBody = Record<string, JsonBody>;

/** Settings whose value is a number in the sidecar and text in the form's selects. */
const NUMERIC_SETTINGS = [
  "requestTimeoutMinutes",
  "checkpointRetentionDays",
] as const;

export function withNumbersAs(
  settings: SettingsBody,
  convert: (value: JsonBody) => JsonBody,
) {
  const converted = { ...settings };
  for (const key of NUMERIC_SETTINGS) {
    if (converted[key] !== undefined && converted[key] !== null) {
      converted[key] = convert(converted[key]);
    }
  }
  return converted;
}

const DEFAULT_MODE_FIELDS = {
  claude: "defaultModeClaude",
  codex: "defaultModeCodex",
} as const;

const DEFAULT_MODES_KEY = "defaultModes";

function isRecord(value: JsonBody | undefined): value is SettingsBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenDefaultModes(settings: SettingsBody) {
  const { [DEFAULT_MODES_KEY]: modes, ...flat } = settings;
  if (!isRecord(modes)) return flat;
  for (const [provider, field] of Object.entries(DEFAULT_MODE_FIELDS)) {
    const mode = Object.hasOwn(modes, provider) ? modes[provider] : undefined;
    if (mode !== undefined) flat[field] = mode;
  }
  return flat;
}

const SCOPE_KEY = "generationMode";
const SAFE_MODE_FIELD = "safeMode";
const SAFE_SCOPE = "safe";
const CODE_SCOPE = "vibe";
const SAFE_MODE_VALUE = z.boolean();

/** The form's Safe mode switch, beside the stored scope it reads from. */
function withSafeMode(settings: SettingsBody) {
  if (!Object.hasOwn(settings, SCOPE_KEY)) return settings;
  return { ...settings, [SAFE_MODE_FIELD]: settings[SCOPE_KEY] === SAFE_SCOPE };
}

/**
 * Settings as the settings form's fields hold them: numbers as text, one
 * field per provider's default mode, the scope also as the Safe mode switch.
 */
export function asFormValues(settings: SettingsBody): SettingsBody {
  return withSafeMode(withNumbersAs(flattenDefaultModes(settings), String));
}

/**
 * The Safe mode switch written back as the stored scope. A value that is not
 * a boolean goes on as the scope, for the sidecar to refuse.
 */
export function scopeFromSafeMode(update: SettingsBody) {
  if (!Object.hasOwn(update, SAFE_MODE_FIELD)) return update;
  const { [SAFE_MODE_FIELD]: safe, ...rest } = update;
  const switchValue = SAFE_MODE_VALUE.safeParse(safe);
  const scope = switchValue.success ? scopeOf(switchValue.data) : safe;
  return { ...rest, [SCOPE_KEY]: scope };
}

function scopeOf(isSafe: boolean) {
  return isSafe ? SAFE_SCOPE : CODE_SCOPE;
}

export function nestDefaultModes(update: SettingsBody) {
  const nested = { ...update };
  const modes: SettingsBody = {};
  for (const [provider, field] of Object.entries(DEFAULT_MODE_FIELDS)) {
    if (Object.hasOwn(nested, field)) modes[provider] = nested[field];
    delete nested[field];
  }
  if (Object.keys(modes).length > 0) nested[DEFAULT_MODES_KEY] = modes;
  return nested;
}
