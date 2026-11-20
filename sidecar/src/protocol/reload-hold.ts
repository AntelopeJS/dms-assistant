import { z } from "zod";

export const RELOAD_HOLD_EVENT = "reload_hold";

/**
 * Server -> reload host: hold the dev watcher's module reloads (`held`) or let
 * them run, answered by `reload_hold_applied` with the same `seq`.
 */
export const ReloadHoldEvent = z.object({
  type: z.literal(RELOAD_HOLD_EVENT),
  held: z.boolean(),
  seq: z.number().int().nonnegative(),
});
