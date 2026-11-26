import { PROVIDER_NAMES, type ProviderName } from "../state/types.js";
import { claudeModule } from "./claude/module.js";
import { codexModule } from "./codex/module.js";
import type { ProviderAvailabilityMap, ProviderModule } from "./types.js";

/** The backend the sidecar drives for a provider, declaring its own wiring. */
export function providerModule(name: ProviderName): ProviderModule {
  switch (name) {
    case "claude":
      return claudeModule;
    case "codex":
      return codexModule;
  }
}

/** Per-provider verdict, as exposed next to `builderAvailable` in GET /settings. */
export function getProviderAvailability(): ProviderAvailabilityMap {
  return {
    claude: claudeModule.checkAvailability(),
    codex: codexModule.checkAvailability(),
  };
}

export function isProviderAvailable(name: ProviderName): boolean {
  return providerModule(name).checkAvailability().available;
}

/** Why the provider cannot be driven, or undefined when it can. */
export function providerUnavailableReason(
  name: ProviderName,
): string | undefined {
  return providerModule(name).checkAvailability().reason;
}

/**
 * Clears whatever a previous sidecar left running, for every backend that has
 * something to clear. Runs before anything new starts.
 */
export async function reapOrphanProviders(stateDir: string): Promise<void> {
  const reaping: Promise<void>[] = [];
  for (const name of PROVIDER_NAMES) {
    const module = providerModule(name);
    if (module.reapOrphans === undefined) continue;
    reaping.push(module.reapOrphans(stateDir));
  }
  await Promise.all(reaping);
}
