/**
 * @param {unknown} value
 * @returns {value is Pick<typeof import("../../../dist/builder/config.js"), "isBuilderEnabled" | "setModuleConfig">}
 */
function exposesConfig(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "isBuilderEnabled" in value &&
    typeof value.isBuilderEnabled === "function" &&
    "setModuleConfig" in value &&
    typeof value.setModuleConfig === "function"
  );
}

/**
 * @param {unknown} value
 * @returns {value is Pick<typeof import("../../../dist/builder/index.js"), "construct">}
 */
function exposesEntry(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "construct" in value &&
    typeof value.construct === "function"
  );
}

module.exports = {
  exposesConfig,
  exposesEntry,
};
