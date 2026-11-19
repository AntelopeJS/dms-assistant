import { registerHooks } from "node:module";

const MOCK_FOLDER = "/sidecar/tests/fixtures/mock-claude/";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const url = specifier.startsWith(".") && context.parentURL ? new URL(specifier, context.parentURL) : null;
      if (url === null || !url.pathname.includes(MOCK_FOLDER) || !url.pathname.endsWith(".js")) throw error;
      return nextResolve(url.href.replace(/\.js$/, ".ts"), context);
    }
  },
});
