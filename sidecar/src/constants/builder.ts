export const SIDECAR_BUILDER_FLAG = "--builder-enabled";

/** The builder tools of the DMS MCP server. */
export const BUILDER_TOOL_NAMES = [
  "builder_catalog",
  "builder_list_pages",
  "builder_page_structure",
  "builder_create_page",
  "builder_configure_page",
  "builder_delete_page",
  "builder_add_block",
  "builder_compose_page",
  "builder_configure_block",
  "builder_configure_table_view",
  "builder_move_block",
  "builder_remove_block",
  "builder_create_category",
  "builder_configure_category",
  "builder_delete_category",
  "builder_refresh",
  "builder_create_resource",
  "builder_delete_resource",
  "builder_list_resources",
  "builder_resource_structure",
  "builder_add_field",
  "builder_configure_field",
  "builder_remove_field",
  "builder_query_templates",
  "builder_add_query",
  "builder_preview_query",
  "builder_configure_query",
  "builder_remove_query",
  "builder_configure_project",
  "builder_map_resources",
  "builder_analyse_database",
  "builder_mapping",
  "builder_get_theme",
  "builder_set_theme",
  "builder_create_theme_layer",
] as const;

/** The mockup tools of the DMS MCP server. */
export const MOCKUP_TOOL_NAMES = [
  "mockup_annotations",
  "mockup_from_page",
  "mockup_patch_spec",
  "mockup_resolve_annotation",
  "mockup_write_spec",
] as const;

export const PAGE_VERIFY_TOOL_NAME = "page_verify";
