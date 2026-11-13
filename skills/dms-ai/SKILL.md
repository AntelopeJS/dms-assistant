---
name: dms-ai
description: Sets up and troubleshoots @antelopejs/dms-assistant, the AI development assistant of the AntelopeJS DMS (chat panel, sidecar running Claude Code or Codex, settings, change sets with undo and audit log pages under /modules/ai). Use when installing or configuring dms-ai (backendUrl, DMS_AI, providers, Codex), when the assistant is offline, or when a module must ship skills to it through antelopeJs.skills.
icon: i-lucide-sparkles
category: ai
tags: [ai, assistant, sidecar, claude-code, codex, skills]
---

# dms-ai

An owner-only development assistant. The backend starts a sidecar (child process, `127.0.0.1` only) that runs the agent in the project folder; the browser reaches it only through the DMS frontend server. User docs: https://dms.antelopejs.com/docs/modules/assistant (source: `docs/` of this package).

## Setup

- `ajs project modules add @antelopejs/dms-assistant`; config `backendUrl: "${@api.API_LOCAL_BASE_URL}"`, builder keys under `builder`. In the `dms` module's config, set `mcp.backendUrl` to the same value.
- The frontend server proxies `/ai/**` to the backend with the session (`backendProxies`). See the package README for requirements.
- Every chat gets two MCP servers: `dms`, the DMS MCP that `@antelopejs/dms` serves in development (the `builder_*`, `database_*`, `mockup_*` tools, `typecheck`, `query_logs`, `list_pages`, `page_verify`), and `dms-ai`, the chat's own (`ask_user`, `get_current_page`, `find_pages_using`, `navigate_to_page`, `preview_blocks`). Chats default to Safe mode (builder tools only, typechecked writes). Code mode allows file edits and commands under the approval mode.
- Claude Code is the default provider. Codex needs `@openai/codex` at the exact version in `peerDependencies` and a ChatGPT sign-in (Assistant › Settings; on a remote DMS the 127.0.0.1 return page fails to load and its address is pasted with **Paste the return address**; stored per user in `~/.config/dms-ai/chatgpt-auth.json`, `OPENAI_API_KEY` is ignored); a provider that cannot run fails the turn, never falls back.

## Skills

The sidecar loads the DMS workflow skills of `@antelopejs/agent-skills` (`dms-pages`, `dms-builder-mcp`, `dms-mockup`, …), then every directory a loaded module declares in `package.json` `antelopeJs.skills` (and `~/.claude/skills` when Settings allow it). Ship a module's skill as `skills/<name>/SKILL.md` with `name`, `description`, `icon`, `category`, `tags: [a, b]` frontmatter, add `skills` to `files`. Two skills with one name: the agent uses the first source's.

## Gotchas

- Refuses to run with `NODE_ENV=production`; `DMS_AI=0` starts the backend without the sidecar.
- Settings is the landing page of the module, then Changes and Activity. Activity opens with the DMS `PageToolbar` (period only, no live: "updated" + refresh). `/ai/activity` filters on the `from` / `to` the table sends; the CSV export ignores them.
- Offline assistant: Restart on the Settings banner; lists and settings answer `503` while the sidecar is down.
- Remote over plain HTTP: start the frontend with `DMS_COOKIE_SECURE=false`.
- The DMS MCP refuses the first call that deletes a page, table, field or query, configures the project, or maps a database in a way that removes a page; the agent asks with `ask_user` and repeats the call to run it. Every edit of a git hook file asks in every mode, Auto review included (anything inside a `.git` directory, `.husky/*`, a lefthook config file, `.pre-commit-config.yaml`), whatever the dependencies toggle says. With Codex, the sandbox is read-only in every mode, so every write asks, and the card for such a file offers no rule.
- Claude Code defaults to Auto review (a safety check approves routine file edits and web access); every shell command, scheduled task and tool it does not know still asks the person, and so does every edit of `package.json`, a lockfile, `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`, `.yarnrc`, `.yarnrc.yml` or `bunfig.toml` unless the person turned off the dependency approval. Codex defaults to Ask first and has no Auto review. Ask first asks before every command, read-only ones included, and before any change outside the Builder. Accept edits applies file edits unasked, except dependency and git hook files, and asks before every command; with Codex it works as Ask first, asking before every file edit and any command that writes.
- Undo is limited to the checkpoint retention (7, 30 or 90 days).
