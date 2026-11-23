import {
	countOf,
	firstOf,
	ICONS,
	joined,
	nested,
	none,
	type ToolLexiconEntry,
} from "./tool-readers";

/** The tools of dms-assistant's own MCP server. */
export const ASSISTANT_TOOLS = {
	get_current_page: {
		verb: "read_current_page",
		icon: ICONS.BROWSER,
		target: none,
		isReadOnly: true,
	},
	navigate_to_page: {
		verb: "open_page",
		icon: ICONS.OPEN,
		target: firstOf("path"),
		isReadOnly: true,
	},
	find_pages_using: {
		verb: "find_pages",
		icon: ICONS.SEARCH,
		target: firstOf("component", "query", "name"),
		isReadOnly: true,
	},
	list_pages: {
		verb: "list_pages",
		icon: ICONS.PAGE,
		target: none,
		isReadOnly: true,
	},
	ask_user: {
		verb: "ask_you",
		icon: ICONS.ASK,
		target: countOf("questions"),
		isReadOnly: true,
	},
	typecheck: {
		verb: "typecheck",
		icon: ICONS.CHECK,
		target: none,
		isReadOnly: true,
	},
	query_logs: {
		verb: "read_logs",
		icon: ICONS.LOGS,
		target: firstOf("query", "search", "level"),
		isReadOnly: true,
	},
	database_connections: {
		verb: "list_databases",
		icon: ICONS.DATA,
		target: none,
		isReadOnly: true,
	},
	database_relations: {
		verb: "list_relations",
		icon: ICONS.DATA,
		target: firstOf("connection"),
		isReadOnly: true,
	},
	database_describe: {
		verb: "describe_relations",
		icon: ICONS.TABLE,
		target: countOf("relations"),
		isReadOnly: true,
	},
	database_project: {
		verb: "read_database_setup",
		icon: ICONS.DATA,
		target: firstOf("connection", "engine"),
		isReadOnly: true,
	},
	mockup_read_spec: {
		verb: "read_mockup",
		icon: ICONS.PAGE,
		target: firstOf("mockup"),
		isReadOnly: true,
	},
	database_profile: {
		verb: "profile_relation",
		icon: ICONS.TABLE,
		target: firstOf("relation", "connection"),
		isReadOnly: true,
	},
} satisfies Record<string, ToolLexiconEntry>;

/** The Builder's tools. */
export const BUILDER_TOOLS = {
	builder_catalog: {
		verb: "browse_blocks",
		icon: ICONS.BLOCK,
		target: none,
		isReadOnly: true,
	},
	builder_list_pages: {
		verb: "list_pages",
		icon: ICONS.PAGE,
		target: none,
		isReadOnly: true,
	},
	builder_page_structure: {
		verb: "read_page",
		icon: ICONS.PAGE,
		target: firstOf("pageRef"),
		isReadOnly: true,
	},
	builder_create_page: {
		verb: "create_page",
		icon: ICONS.CREATE_PAGE,
		target: firstOf("displayName", "name"),
	},
	builder_configure_page: {
		verb: "configure_page",
		icon: ICONS.PAGE,
		target: firstOf("pageRef"),
	},
	builder_delete_page: {
		verb: "delete_page",
		icon: ICONS.DELETE,
		target: firstOf("pageRef"),
	},
	builder_add_block: {
		verb: "add_block",
		icon: ICONS.BLOCK,
		target: joined(firstOf("name"), firstOf("type")),
	},
	builder_configure_block: {
		verb: "configure_block",
		icon: ICONS.BLOCK,
		target: firstOf("path"),
	},
	builder_compose_page: {
		verb: "compose_page",
		icon: ICONS.BLOCK,
		target: firstOf("pageRef"),
	},
	builder_configure_table_view: {
		verb: "configure_table_view",
		icon: ICONS.BLOCK,
		target: firstOf("pageRef"),
	},
	builder_move_block: {
		verb: "move_block",
		icon: ICONS.BLOCK,
		target: firstOf("path"),
	},
	builder_remove_block: {
		verb: "remove_block",
		icon: ICONS.BLOCK,
		target: firstOf("path"),
	},
	builder_create_category: {
		verb: "create_category",
		icon: ICONS.CATEGORY,
		target: firstOf("displayName", "name"),
	},
	builder_configure_category: {
		verb: "configure_category",
		icon: ICONS.CATEGORY,
		target: firstOf("ref"),
	},
	builder_delete_category: {
		verb: "delete_category",
		icon: ICONS.DELETE,
		target: firstOf("ref"),
	},
	builder_refresh: {
		verb: "refresh_builder",
		icon: ICONS.REFRESH,
		target: firstOf("pageRef"),
		isReadOnly: true,
	},
	builder_list_resources: {
		verb: "list_tables",
		icon: ICONS.TABLE,
		target: none,
		isReadOnly: true,
	},
	builder_resource_structure: {
		verb: "read_table",
		icon: ICONS.TABLE,
		target: firstOf("ref"),
		isReadOnly: true,
	},
	builder_configure_project: {
		verb: "configure_project",
		icon: ICONS.DATA,
		target: none,
	},
	builder_map_resources: {
		verb: "map_tables",
		icon: ICONS.TABLE,
		target: firstOf("connection", "module"),
	},
	builder_mapping: {
		verb: "read_mapping",
		icon: ICONS.TABLE,
		target: firstOf("connection", "module"),
		isReadOnly: true,
	},
	builder_analyse_database: {
		verb: "analyse_database",
		icon: ICONS.TABLE,
		target: firstOf("connection", "job"),
		isReadOnly: true,
	},
	builder_create_resource: {
		verb: "create_table",
		icon: ICONS.TABLE,
		target: firstOf("displayName", "name"),
	},
	builder_delete_resource: {
		verb: "delete_table",
		icon: ICONS.DELETE,
		target: firstOf("ref"),
	},
	builder_add_field: {
		verb: "add_field",
		icon: ICONS.FIELD,
		target: joined(firstOf("ref"), nested("field", "name")),
	},
	builder_configure_field: {
		verb: "configure_field",
		icon: ICONS.FIELD,
		target: firstOf("path"),
	},
	builder_configure_column_groups: {
		verb: "configure_column_groups",
		icon: ICONS.FIELD,
		target: firstOf("resource"),
	},
	mockup_apply_to_page: {
		verb: "apply_mockup",
		icon: ICONS.PAGE,
		target: firstOf("mockup", "page"),
	},
	builder_remove_field: {
		verb: "remove_field",
		icon: ICONS.FIELD,
		target: firstOf("path"),
	},
	builder_query_templates: {
		verb: "browse_queries",
		icon: ICONS.DATA,
		target: firstOf("resourceType"),
		isReadOnly: true,
	},
	builder_add_query: {
		verb: "add_query",
		icon: ICONS.DATA,
		target: firstOf("name"),
	},
	builder_preview_query: {
		verb: "preview_query",
		icon: ICONS.DATA,
		target: firstOf("name"),
		isReadOnly: true,
	},
	builder_configure_query: {
		verb: "configure_query",
		icon: ICONS.DATA,
		target: firstOf("path", "name"),
	},
	builder_remove_query: {
		verb: "remove_query",
		icon: ICONS.DATA,
		target: firstOf("path", "name"),
	},
} satisfies Record<string, ToolLexiconEntry>;

export const DMS_TOOLS = {
	page_verify: {
		verb: "verify_page",
		icon: ICONS.CHECK,
		target: firstOf("page"),
		isReadOnly: true,
	},
} satisfies Record<string, ToolLexiconEntry>;
