const CONSTRUCTS = Symbol.for("dms-assistant-e2e/app-constructs");

type Holder = typeof globalThis & { [CONSTRUCTS]?: number };

/** Counts a construction of this module: the count lives on the process, so it survives the module's reloads. */
export function countConstruct(): void {
  const holder: Holder = globalThis;
  holder[CONSTRUCTS] = (holder[CONSTRUCTS] ?? 0) + 1;
}

/** How many times the process constructed this module: its first load and each reload since. */
export function constructs(): number {
  const holder: Holder = globalThis;
  return holder[CONSTRUCTS] ?? 0;
}
