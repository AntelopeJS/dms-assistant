import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import type {
  FieldGroup,
  FormField,
  FormSection,
} from "@antelopejs/interface-dms/base/form-types";
import {
  PROVIDER_OPTIONS,
  REQUEST_TIMEOUT_OPTIONS,
  RETENTION_OPTIONS,
  settingsText,
  THINKING_OPTIONS,
} from "./options";

const NEXT_TURN_HINT = settingsText("hints", "next_turn");
const NEXT_MESSAGE_HINT = settingsText("hints", "next_message");

function switchType(field: string) {
  return new DefaultDataTypes.BooleanType({
    label: settingsText(field, "label"),
    description: settingsText(field, "description"),
  });
}

const PROVIDER_FIELD: FormField = {
  id: "provider",
  label: settingsText("provider", "label"),
  description: settingsText("provider", "description"),
  hint: NEXT_TURN_HINT,
  type: new DefaultDataTypes.SelectType({
    display: "cards",
    items: PROVIDER_OPTIONS,
  }),
  required: true,
};

const MODEL_FIELD: FormField = {
  id: "claudeModel",
  label: settingsText("claude_model", "label"),
  description: settingsText("claude_model", "description"),
  hint: NEXT_MESSAGE_HINT,
  type: new DefaultDataTypes.StringType({
    placeholder: "claude-opus-5-5",
  }),
  required: true,
};

const THINKING_FIELD: FormField = {
  id: "thinking",
  label: settingsText("thinking", "label"),
  description: settingsText("thinking", "description"),
  hint: NEXT_MESSAGE_HINT,
  type: new DefaultDataTypes.SelectType({
    display: "segmented",
    items: THINKING_OPTIONS,
  }),
  required: true,
};

const UNANSWERED_GROUP: FieldGroup = {
  id: "unanswered",
  label: settingsText("unanswered", "label"),
  description: settingsText("unanswered", "description"),
  orientation: "vertical",
  fields: [
    {
      id: "requestTimeoutMinutes",
      label: settingsText("request_timeout", "label"),
      type: new DefaultDataTypes.SelectType({
        items: REQUEST_TIMEOUT_OPTIONS,
      }),
      required: true,
    },
    { id: "notifyRequests", type: switchType("notify_requests") },
  ],
};

const AI: FormSection = {
  id: "ai",
  label: settingsText("sections", "ai", "label"),
  description: settingsText("sections", "ai", "description"),
  icon: "i-ph-sparkle",
  fields: [PROVIDER_FIELD, MODEL_FIELD, THINKING_FIELD, UNANSWERED_GROUP],
};

const RETENTION_FIELD: FormField = {
  id: "checkpointRetentionDays",
  label: settingsText("checkpoint_retention", "label"),
  description: settingsText("checkpoint_retention", "description"),
  type: new DefaultDataTypes.SelectType({ items: RETENTION_OPTIONS }),
  required: true,
};

const BUILDER: FormSection = {
  id: "builder",
  label: settingsText("sections", "builder", "label"),
  description: settingsText("sections", "builder", "description"),
  icon: "i-ph-hammer",
  fields: [RETENTION_FIELD],
};

/**
 * The settings form's sections: the agent, then the Builder. The guard rails
 * are not here: a form's save cannot send the assistant UI's header, which
 * `PUT /ai/settings` requires to write them (see the Guard rails card).
 */
export const SETTINGS_SECTIONS: FormSection[] = [AI, BUILDER];
