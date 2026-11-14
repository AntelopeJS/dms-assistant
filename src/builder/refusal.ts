import type { BuilderError } from "@antelopejs/interface-dms-builder";

export function refusalMessage(error: BuilderError): string {
  if (error.code === "invalid_config") {
    return error.issues.map((issue) => issue.message).join("; ");
  }
  return error.code === "unsupported" ? error.detail : error.code;
}
