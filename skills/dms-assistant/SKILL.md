---
name: dms-assistant
description: Sets up and troubleshoots @antelopejs/dms-assistant, the AI development assistant of the AntelopeJS DMS (chat panel, sidecar running Claude Code or Codex, settings, change sets with undo and audit log pages under /modules/ai). Use when installing or configuring dms-assistant (backendUrl, DMS_ASSISTANT, providers, Codex), when the assistant is offline, or when a module must ship skills to it through antelopeJs.skills.
icon: i-lucide-sparkles
category: ai
tags: [ai, assistant, sidecar, claude-code, codex, skills]
---

# dms-assistant

An owner-only development assistant. The backend starts a sidecar (child process, `127.0.0.1` only) that runs the agent in the project folder; the browser reaches it only through the DMS frontend server. User docs: https://dms.antelopejs.com/docs/modules/assistant (source: `docs/` of this package).

## Setup

- `ajs project modules add @antelopejs/dms-assistant`; config `backendUrl: "${@api.API_LOCAL_BASE_URL}"`, builder keys under `builder`. In the `dms` module's config, set `mcp.backendUrl` to the same value.
- The frontend server proxies `/ai/**` to the backend with the session (`backendProxies`). See the package README for requirements.
- Every chat gets two MCP servers: `dms`, the DMS MCP that `@antelopejs/dms` serves in development (the `builder_*`, `database_*`, `mockup_*` tools, `typecheck`, `query_logs`, `list_pages`, `page_verify`), and `dms-assistant`, the chat's own (`ask_user`, `get_current_page`, `find_pages_using`, `navigate_to_page`, `preview_blocks`). Chats default to Safe mode (builder tools only, typechecked writes). Code mode allows file edits and commands under the approval mode.
- Claude Code is the default provider. Codex needs `@openai/codex` at the exact version in `peerDependencies` and a ChatGPT sign-in (Assistant › Settings; on a remote DMS the 127.0.0.1 return page fails to load and its address is pasted with **Paste the return address**; stored per user in `~/.config/dms-assistant/chatgpt-auth.json`, `OPENAI_API_KEY` is ignored); a provider that cannot run fails the turn, never falls back.

## Mockup prompts

The mockup editor of `@antelopejs/dms` hands the assistant a prompt through the cancelable `dms:assistant-prompt` window event (`frontend-vue/app/runtime/assistant-prompt.ts`). A detail that parses is claimed (`preventDefault`) and opens the panel; one that does not parse is left to the editor. `source` `connect-data` and `custom-zone` (`prompt`, `block`) fill the composer and send nothing. `new-mockup` (`prompt` is the start of a sentence) starts a new conversation and fills the composer with it, focused with the caret at the end, and sends nothing. `build` (`prompt` is the mockup name, optional `title` and `target.pageRef`) and `resolve-comments` (`prompt` is the mockup name, optional `title` and `page`) start a new conversation and send their message at once, and the turn shows in the chat like any other. A `title` that differs from the name is quoted beside it. `build` asks the agent to end its reply with a link to each page it built. `resolve-comments` states its own steps and needs no skill: list the open annotations with `mockup_annotations`, patch the spec with `mockup_patch_spec` from each annotation's `path` and node without reading `spec.json`, and resolve each one with `mockup_resolve_annotation`. While a `build` or `resolve-comments` run of a mockup goes on, another prompt with the same `source` and mockup is still claimed but starts nothing: the panel opens on the running conversation. The panel dispatches the window event `dms:assistant-run` (`{ mockup, source, running }`, `running` false when the run finished, failed or was stopped) when such a run starts and ends, and answers the window event `dms:assistant-run-query` (no detail) with `running: true` for each run going on (`frontend-vue/app/runtime/mockup-runs.ts`).

## Skills

The sidecar loads the DMS workflow skills of `@antelopejs/agent-skills` (`dms-pages`, `dms-builder-mcp`, `dms-mockup`, …), then every directory a loaded module declares in `package.json` `antelopeJs.skills` (and `~/.claude/skills` when Settings allow it). Ship a module's skill as `skills/<name>/SKILL.md` with `name`, `description`, `icon`, `category`, `tags: [a, b]` frontmatter, add `skills` to `files`. Two skills with one name: the agent uses the first source's.

## Gotchas

- Refuses to run with `NODE_ENV=production`; `DMS_ASSISTANT=0` starts the backend without the sidecar.
- Settings is the landing page of the module, then Changes and Activity. Activity opens with the DMS `PageToolbar` (period only, no live: "updated" + refresh). `/ai/activity` filters on the `from` / `to` the table sends; the CSV export ignores them.
- Offline assistant: Restart on the Settings banner; lists and settings answer `503` while the sidecar is down.
- Remote over plain HTTP: start the frontend with `DMS_COOKIE_SECURE=false`.
- The DMS MCP refuses the first call that deletes a page, table, field or query, configures the project, or maps a database in a way that removes a page. The agent repeats the identical call at once, and the chat shows the person that call on an approval card before it runs; a declined card refuses it. Every edit of a git hook file asks in every mode, Auto review included (anything inside a `.git` directory, `.husky/*`, a lefthook config file, `.pre-commit-config.yaml`), whatever the dependencies toggle says, and so does every edit of `antelope.config.ts`, an `antelope.*.json` file or a file under `.antelope/`, which AntelopeJS core reads each module's configuration from, database URLs included. With Codex, the sandbox is read-only in every mode, so every write asks, and the card for such a file offers no rule.
- Claude Code defaults to Auto review (a safety check approves routine file edits and web access); every shell command, scheduled task and tool it does not know still asks the person, and so does every edit of `package.json`, a lockfile, `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`, `.yarnrc`, `.yarnrc.yml` or `bunfig.toml` unless the person turned off the dependency approval. Codex defaults to Ask first and has no Auto review. Ask first asks before every command, read-only ones included, and before any change outside the Builder. Accept edits applies file edits unasked, except dependency files, git hook files and those project configuration files, and asks before every command; with Codex it works as Ask first, asking before every file edit and any command that writes.
- Undo is limited to the checkpoint retention (7, 30 or 90 days).
