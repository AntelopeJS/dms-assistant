import { z } from "zod";
import { buildPreviewBlocksTool } from "../../src/mcp/tools/preview-blocks.js";
import type {
  BlockPreviewType,
  PreviewNodeType,
} from "../../src/protocol/preview.js";

export const KPI_NODE: PreviewNodeType = {
  type: "KpiCard",
  options: { label: "Revenue", value: "12 400 €" },
};
export const SKETCH = {
  html: '<article class="card"><h3>Revenue</h3><p class="value">12 400 €</p><img alt="" src="data:image/png;base64,AA"><a href="#trend">Trend</a></article>',
  css: ".card { background: var(--sketch-surface); background-image: url('data:image/svg+xml,%3Csvg%3E%3C/svg%3E'); }",
  caption: "Revenue card with a sparkline",
  height: 240,
};

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

type PreviewTool = ReturnType<typeof buildPreviewBlocksTool>;
type PreviewArgs = Parameters<PreviewTool["handler"]>[0];

const ABSENT_ARGS = {
  description: undefined,
  label: undefined,
  tree: undefined,
  sketch: undefined,
  reference: undefined,
  variants: undefined,
};

interface ToolLike {
  name: string;
  schema: PreviewTool["schema"];
  handler: (
    args: Partial<PreviewArgs> & Pick<PreviewArgs, "title">,
  ) => Promise<ToolResult>;
}

interface Harness {
  shown: BlockPreviewType[];
  tool: ToolLike;
}

export function buildHarness(attached: string[] = []): Harness {
  const shown: BlockPreviewType[] = [];
  const built = buildPreviewBlocksTool({
    showPreview: (preview) => shown.push(preview),
    listAttachedImages: () => attached,
  });
  const tool: ToolLike = {
    name: built.name,
    schema: built.schema,
    handler: (args) => built.handler({ ...ABSENT_ARGS, ...args }),
  };
  return { shown, tool };
}

const ParsedBodySchema = z.looseObject({
  ok: z.boolean().optional(),
  message: z.string().optional(),
  data: z.looseObject({ previewId: z.string().optional() }).optional(),
  error: z.looseObject({ code: z.string().optional() }).optional(),
});

export function parse(result: ToolResult) {
  return ParsedBodySchema.parse(JSON.parse(result.content[0]?.text ?? "{}"));
}
