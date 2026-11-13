import type { PageDraft } from "@antelopejs/interface-dms-builder";

type PageSettings = NonNullable<PageDraft["page"]>;

/**
 * A page draft whose `fields` hold `null`, as a JSON client may send them: off-contract for the
 * types, so it is built at run time.
 */
export function nullDraft(...fields: (keyof PageSettings)[]): PageSettings {
  const draft: PageSettings = {};
  for (const field of fields) Reflect.set(draft, field, null);
  return draft;
}
