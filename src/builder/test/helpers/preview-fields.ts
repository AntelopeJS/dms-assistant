function isPreviewField(value: unknown): value is { id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  );
}

/** Whether a form preview's fields are all objects with a string `id`, the one member a spec reads. */
export function isPreviewFieldList(value: unknown): value is { id: string }[] {
  return Array.isArray(value) && value.every(isPreviewField);
}
