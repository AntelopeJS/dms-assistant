import { serializeConfirmDialog } from "@antelopejs/interface-dms/base/confirm-dialog";
import type { ConfirmDialog } from "@antelopejs/interface-dms/base/types";
import { I18N_SECTIONS } from "../constants/i18n";
import type { ArtifactSummary } from "../types";
import { i18nKey } from "../vocabulary";

function text(key: string): string {
  return i18nKey(I18N_SECTIONS.ARTIFACTS_TABLE, "delete_confirm", key);
}

/**
 * The dialog Delete asks in, named after the artifact: the artifact goes
 * for good, the conversation it came from stays. The title is a parameter of
 * the texts, which vue-i18n interpolates as a value, never as markup.
 */
export function deleteConfirmDialog(artifact: Pick<ArtifactSummary, "title">) {
  const dialog: ConfirmDialog = {
    title: text("title"),
    description: text("description"),
    params: { title: artifact.title },
    icon: "i-ph-trash",
    color: "error",
    confirmLabel: text("confirm"),
  };
  return serializeConfirmDialog(dialog);
}
