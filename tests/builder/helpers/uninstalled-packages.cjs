const Module = require("node:module");
const { z } = require("zod");

const RequireMethodSchema = z.instanceof(Function);

/**
 * Makes every `require` of the named packages fail as Node fails when they are not installed,
 * through `createRequire` as well. Returns a function that installs them again.
 *
 * @param {string[]} names
 * @returns {() => void}
 */
function uninstallPackages(names) {
  const original = RequireMethodSchema.parse(
    Object.getOwnPropertyDescriptor(Module.prototype, "require")?.value,
  );
  /**
   * @this {Module}
   * @param {string} request
   * @returns {unknown}
   */
  Module.prototype.require = function (request) {
    if (names.includes(request)) {
      throw Object.assign(
        new Error(
          `Cannot find module '${request}'\nRequire stack:\n- ${__filename}`,
        ),
        { code: "MODULE_NOT_FOUND" },
      );
    }
    return original.call(this, request);
  };
  return () => {
    Object.defineProperty(Module.prototype, "require", { value: original });
  };
}

module.exports = { uninstallPackages };
