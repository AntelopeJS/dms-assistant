import { z } from "zod";
import {
  ArtifactBlocksSchema,
  type ArtifactSpec,
  ArtifactSpecSchema,
} from "../../artifacts/spec.js";
import type { ArtifactRecord } from "../../artifacts/types.js";
import {
  ARTIFACT_LIMITS,
  ARTIFACT_QUERY_PARAM,
  ARTIFACTS_PAGE_PATH,
  CREATE_ARTIFACT_RESULT_HINT,
  CREATE_ARTIFACT_RESULT_PREFIX,
  CREATE_ARTIFACT_TOOL_DESCRIPTION,
  CREATE_ARTIFACT_TOOL_NAME,
} from "../../constants/artifacts.js";
import { defineTool, type McpToolResult } from "../define-tool.js";

export interface CreateArtifactDeps {
  /** Stores the artifact for the tool's conversation and hands the record back. */
  saveArtifact: (spec: ArtifactSpec) => ArtifactRecord;
}

const INPUT_SCHEMA = {
  title: z.string().trim().min(1).max(ARTIFACT_LIMITS.TITLE_CHARS),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(ARTIFACT_LIMITS.SUMMARY_CHARS)
    .optional(),
  blocks: ArtifactBlocksSchema,
} as const;

type CreateArtifactArgs = {
  title: string;
  summary: string | undefined;
  blocks: ArtifactSpec["blocks"];
};

/** The dashboard path that opens the artifact. */
export function artifactPagePath(id: string): string {
  const query = new URLSearchParams({ [ARTIFACT_QUERY_PARAM]: id });
  return `${ARTIFACTS_PAGE_PATH}?${query.toString()}`;
}

function buildResultText(record: ArtifactRecord): string {
  const { title, blocks } = record.spec;
  return [
    `${CREATE_ARTIFACT_RESULT_PREFIX}"${title}" (${record.kind}, ${blocks.length} block${blocks.length === 1 ? "" : "s"}, id ${record.id}).`,
    `The user opens it at ${artifactPagePath(record.id)}.`,
    CREATE_ARTIFACT_RESULT_HINT,
  ].join(" ");
}

function textContent(text: string, isError = false): McpToolResult {
  return { content: [{ type: "text", text }], isError };
}

/**
 * The tool that saves an artifact of the conversation. Its arguments are the
 * artifact's data, read once more by the spec schema as a whole, so what the
 * store holds is exactly what the schema allows and nothing a binding let
 * through.
 */
export function buildCreateArtifactTool(deps: CreateArtifactDeps) {
  return defineTool(
    CREATE_ARTIFACT_TOOL_NAME,
    CREATE_ARTIFACT_TOOL_DESCRIPTION,
    INPUT_SCHEMA,
    async ({ title, summary, blocks }: CreateArtifactArgs) => {
      const parsed = ArtifactSpecSchema.safeParse(
        summary === undefined ? { title, blocks } : { title, summary, blocks },
      );
      if (!parsed.success) {
        return textContent(
          `Artifact refused: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
          true,
        );
      }
      return textContent(buildResultText(deps.saveArtifact(parsed.data)));
    },
  );
}
