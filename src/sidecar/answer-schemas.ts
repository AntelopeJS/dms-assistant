import { z } from "zod";
import type { UsageReport } from "../types";

export const USAGE_ANSWER: z.ZodType<UsageReport> = z.looseObject({
  days: z.array(z.looseObject({ day: z.string(), totalTokens: z.number() })),
  totalTokens: z.number(),
  conversations: z.number(),
  top: z
    .looseObject({
      conversationId: z.string(),
      title: z.string(),
      totalTokens: z.number(),
    })
    .optional(),
});
