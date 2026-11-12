import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import type {
  FieldGroup,
  FormField,
  FormSection,
} from "@antelopejs/interface-dms/base/form-types";
import {
  CLAUDE_MODE_OPTIONS,
  CODEX_MODE_OPTIONS,
  PROVIDER_OPTIONS,
  REQUEST_TIMEOUT_OPTIONS,
  RETENTION_OPTIONS,
  settingsText,
  THINKING_OPTIONS,
} from "./options";

const NEXT_TURN_HINT = settingsText("hints", "next_turn");
const NEXT_MESSAGE_HINT = settingsText("hints", "next_message");
const NEW_CONVERSATIONS_HINT = settingsText("hints", "new_conversations");

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

const DEFAULT_MODE_FIELDS: FormField[] = [
  {
    id: "defaultModeClaude",
    label: settingsText("default_mode_claude", "label"),
    description: settingsText("default_mode_claude", "description"),
    hint: NEW_CONVERSATIONS_HINT,
    type: new DefaultDataTypes.SelectType({
      display: "cards",
      items: CLAUDE_MODE_OPTIONS,
    }),
    required: true,
  },
  {
    id: "defaultModeCodex",
    label: settingsText("default_mode_codex", "label"),
    description: settingsText("default_mode_codex", "description"),
    hint: NEW_CONVERSATIONS_HINT,
    type: new DefaultDataTypes.SelectType({
      display: "cards",
      items: CODEX_MODE_OPTIONS,
    }),
    required: true,
  },
];

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

const LOCAL_SKILLS_FIELD: FormField = {
  id: "allowLocalSkills",
  label: settingsText("allow_local_skills", "title"),
  hint: NEW_CONVERSATIONS_HINT,
  type: switchType("allow_local_skills"),
};

const AI: FormSection = {
  id: "ai",
  label: settingsText("sections", "ai", "label"),
  description: settingsText("sections", "ai", "description"),
  icon: "i-ph-sparkle",
  fields: [
    PROVIDER_FIELD,
    MODEL_FIELD,
    THINKING_FIELD,
    ...DEFAULT_MODE_FIELDS,
    UNANSWERED_GROUP,
    LOCAL_SKILLS_FIELD,
  ],
};

const SAFE_MODE_FIELD: FormField = {
  id: "safeMode",
  label: settingsText("safe_mode", "label"),
  description: settingsText("safe_mode", "description"),
  hint: NEW_CONVERSATIONS_HINT,
  type: switchType("safe_mode"),
};

const ALWAYS_ASK_GROUP: FieldGroup = {
  id: "alwaysAsk",
  label: settingsText("always_ask", "label"),
  description: settingsText("always_ask", "description"),
  orientation: "vertical",
  fields: [
    {
      id: "alwaysAskDeletions",
      label: settingsText("always_ask_deletions", "label"),
      type: switchType("always_ask_deletions"),
      readonly: {
        badge: {
          label: settingsText("always_ask_deletions", "locked"),
          tone: "neutral",
        },
      },
    },
    {
      id: "alwaysAskDependencies",
      type: switchType("always_ask_dependencies"),
    },
    {
      id: "alwaysAskBlockRemoval",
      type: switchType("always_ask_block_removal"),
    },
  ],
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
  fields: [SAFE_MODE_FIELD, ALWAYS_ASK_GROUP, RETENTION_FIELD],
};

/** The settings form's sections: the agent, then the Builder. */
export const SETTINGS_SECTIONS: FormSection[] = [AI, BUILDER];
