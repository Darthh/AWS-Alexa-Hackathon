# Friction log

Issues we hit with SDKs, docs, and tools while building Off-Peak, logged as they happened.

### ext-apps 2.x silently requires the v2 MCP SDK
- Task attempted: Add `@modelcontextprotocol/ext-apps` (MCP Apps) to a server built on `@modelcontextprotocol/sdk` v1 for protocol 2025-11-25 (what Alexa+ supports).
- Steps taken: `npm view @modelcontextprotocol/ext-apps@latest peerDependencies`.
- Expected: The latest ext-apps works with the SDK that targets the protocol version Alexa+ supports.
- Actual: ext-apps 2.0.x peers on `@modelcontextprotocol/server|client|core@^2`, which target 2026-07-28 (no `initialize` handshake). The README's install line pulls the incompatible major.
- Severity: major
- Workaround: Pin `@modelcontextprotocol/ext-apps@1.7.5` (peers on `@modelcontextprotocol/sdk ^1.29`).
- Suggestion: A compatibility table (ext-apps major ↔ SDK major ↔ protocol version) at the top of the ext-apps README, and a `v1` dist-tag.

### `npx @modelcontextprotocol/inspector` changed CLI between majors
- Task attempted: Verify the server with the Inspector CLI, using the `--cli <url> --transport http --method tools/list` flags from docs and blog posts.
- Steps taken: Ran `npx @modelcontextprotocol/inspector --cli …` (resolves to 2.11.0).
- Expected: The documented flags work.
- Actual: v2 moved scripting to a separate `mcpdo` binary with named connections (`mcpdo connect <url>`, then `--connection <name>` on every call in non-interactive mode). v1 still works but prints four deprecation warnings per run.
- Severity: minor
- Workaround: Pin `@modelcontextprotocol/inspector@0.22.0` for the one-liner; v2 `mcpdo` also connects and reports "Era: legacy (2025-11-25)".
- Suggestion: Keep a one-shot `--cli` compatibility mode in v2, and mention in the deprecation warning which flags map to which `mcpdo` commands.

### TypeScript `latest` is the 7.0 native port
- Task attempted: Pick a TypeScript version for a strict ESM monorepo.
- Steps taken: `npm view typescript dist-tags` → `latest: 7.0.2`; `npm view typescript-eslint peerDependencies` → `typescript <6.1.0`.
- Expected: `latest` works with the ecosystem's standard lint tooling.
- Actual: Compiler-API tools aren't compatible with 7.0 yet.
- Severity: minor
- Workaround: Pin `typescript@6.0.3`.
- Suggestion: n/a (ecosystem transition); worth a note in MCP SDK templates that pin TS.
