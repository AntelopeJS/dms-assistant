import type { ConfigValue } from "@antelopejs/interface-dms-builder";

/** What a message shows for a value JSON cannot write, such as one that contains itself. */
const UNWRITABLE_VALUE = "a value JSON cannot represent";

/**
 * A rejected value, as it appears in a validation message.
 *
 * These messages report input that failed its own type: the interface functions
 * are called in-process by other modules, so the declared type is not
 * enforced at run time -- which is the whole reason the message exists. Total by
 * construction: JSON.stringify throws on a cycle and on BigInt, and returns
 * `undefined` for `undefined`, a function or a symbol, so a message meant to
 * explain a refusal never throws out of the OpResult channel.
 */
export function describeValue(value: ConfigValue): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return UNWRITABLE_VALUE;
  }
}
