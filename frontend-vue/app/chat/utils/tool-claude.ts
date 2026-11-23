import {
	countOf,
	fileOf,
	firstOf,
	hostOf,
	ICONS,
	none,
	quoted,
	toolQuery,
	type ToolLexiconEntry,
} from "./tool-readers";

/** The tools Claude has built in. */
export const CLAUDE_TOOLS = {
	Read: {
		verb: "read_file",
		icon: ICONS.READ,
		target: fileOf("file_path"),
		isReadOnly: true,
	},
	Write: { verb: "write_file", icon: ICONS.EDIT, target: fileOf("file_path") },
	Edit: { verb: "edit_file", icon: ICONS.EDIT, target: fileOf("file_path") },
	MultiEdit: {
		verb: "edit_file",
		icon: ICONS.EDIT,
		target: fileOf("file_path"),
	},
	NotebookEdit: {
		verb: "edit_notebook",
		icon: ICONS.EDIT,
		target: fileOf("notebook_path"),
	},
	Bash: {
		verb: "run_command",
		icon: ICONS.COMMAND,
		target: firstOf("command"),
	},
	BashOutput: {
		verb: "read_output",
		icon: ICONS.COMMAND,
		target: firstOf("bash_id"),
		isReadOnly: true,
	},
	KillShell: {
		verb: "stop_command",
		icon: ICONS.COMMAND,
		target: firstOf("shell_id"),
	},
	KillBash: {
		verb: "stop_command",
		icon: ICONS.COMMAND,
		target: firstOf("shell_id"),
	},
	Glob: {
		verb: "find_files",
		icon: ICONS.SEARCH,
		target: firstOf("pattern"),
		isReadOnly: true,
	},
	Grep: {
		verb: "search_code",
		icon: ICONS.SEARCH,
		target: quoted("pattern"),
		isReadOnly: true,
	},
	LS: {
		verb: "list_folder",
		icon: ICONS.FOLDER,
		target: firstOf("path"),
		isReadOnly: true,
	},
	WebFetch: { verb: "fetch_url", icon: ICONS.WEB, target: hostOf("url") },
	WebSearch: {
		verb: "search_web",
		icon: ICONS.WEB,
		target: quoted("query"),
		isReadOnly: true,
	},
	TodoWrite: {
		verb: "update_steps",
		icon: ICONS.STEPS,
		target: countOf("todos"),
		isReadOnly: true,
	},
	Task: {
		verb: "delegate",
		icon: ICONS.DELEGATE,
		target: firstOf("description"),
	},
	Agent: {
		verb: "delegate",
		icon: ICONS.DELEGATE,
		target: firstOf("description"),
	},
	ExitPlanMode: {
		verb: "propose_plan",
		icon: ICONS.PLAN,
		target: none,
		isReadOnly: true,
	},
	AskUserQuestion: {
		verb: "ask_you",
		icon: ICONS.ASK,
		target: countOf("questions"),
		isReadOnly: true,
	},
	Skill: {
		verb: "use_skill",
		icon: ICONS.SKILL,
		target: firstOf("skill", "command"),
		isReadOnly: true,
	},
	SlashCommand: {
		verb: "run_slash_command",
		icon: ICONS.SKILL,
		target: firstOf("command"),
	},
	ToolSearch: {
		verb: "search_tools",
		icon: ICONS.SEARCH,
		target: toolQuery,
		isReadOnly: true,
	},
} satisfies Record<string, ToolLexiconEntry>;
