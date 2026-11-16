import { I18N_SECTIONS } from "../../constants/i18n";
import { i18nKey, type VocabularyOption } from "../../vocabulary";

const SECTION = I18N_SECTIONS.SETTINGS;

/** A settings text, under `$dms_assistant.settings`. */
export function settingsText(...segments: string[]): string {
  return i18nKey(SECTION, ...segments);
}

interface ChoiceDeclaration {
  value: string;
  icon?: string;
  /** Shown, never picked. */
  disabled?: boolean;
}

/** Options labelled `<field>.<value>.label`, described `<field>.<value>.description`. */
function choices(
  field: string,
  declarations: readonly ChoiceDeclaration[],
): VocabularyOption[] {
  return declarations.map(({ value, icon, disabled }) => ({
    value,
    label: settingsText(field, value, "label"),
    description: settingsText(field, value, "description"),
    icon,
    disabled,
  }));
}

/** Options labelled `<field>.<value>`, for compact selects. */
function labels(field: string, values: readonly string[]): VocabularyOption[] {
  return values.map((value) => ({
    value,
    label: settingsText(field, "options", value),
  }));
}

export const CODEX_PROVIDER = "codex";

export const PROVIDER_OPTIONS = choices("provider", [
  { value: "claude", icon: "i-ph-robot" },
  { value: CODEX_PROVIDER, icon: "i-ph-robot" },
]);

export const THINKING_OPTIONS = labels("thinking", [
  "off",
  "low",
  "medium",
  "high",
]);

/** Numeric settings travel as strings: a select's values are text. */
export const REQUEST_TIMEOUT_OPTIONS = labels("request_timeout", [
  "5",
  "15",
  "30",
]);

export const RETENTION_OPTIONS = labels("checkpoint_retention", [
  "7",
  "30",
  "90",
]);
