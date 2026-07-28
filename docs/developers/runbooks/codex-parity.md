# Runbook: Claude Code ↔ OpenAI Codex harness parity

**Design authority:** D-9 in `design-decisions.md`. **Generator:** `scripts/sync-codex.ts`.

This repo is maintained for two agent harnesses from one hand-edited source. Part 1 is how to
operate it here. Part 2 is the portable recipe — read that if you are rebuilding this adapter in
another repo.

> Verified against **codex-cli 0.144.6** and **Claude Code** on **2026-07-28**. Both lines move
> fast; re-verify the schema claims in Part 2 before trusting them in a new repo.

---

## Part 1 — Operating it here

### The invariant

`.claude/**` and `.mcp.json` are the **only** hand-edited harness files. Everything Codex reads is
generated:

| Concern      | Source (edit this)    | Generated (never edit) | Mechanism                        |
| ------------ | --------------------- | ---------------------- | -------------------------------- |
| Instructions | `CLAUDE.md`           | `AGENTS.md`            | concatenate + inline rules       |
| Rules        | `.claude/rules/*.md`  | inlined into AGENTS.md | headings demoted, text as-is     |
| Subagents    | `.claude/agents/*.md` | `.codex/agents/*.toml` | body → `developer_instructions`  |
| Skills       | `.claude/skills/*/`   | `.agents/skills/*`     | **symlink** (one copy on disk)   |
| Hooks        | `.claude/hooks/*.sh`  | `.codex/hooks.json`    | **same scripts**, both harnesses |
| MCP          | `.mcp.json`           | `.codex/config.toml`   | `[mcp_servers.<name>]`           |

### Daily use

```bash
bun run sync-codex           # regenerate the Codex mirror
bun run sync-codex --check   # fail if stale (runs inside `bun run validate`)
```

`bun run validate` — and therefore the pre-commit hook — fails on drift, so a stale mirror cannot
be committed. If validate reports `codex mirror: STALE`, run `bun run sync-codex` and commit the
result; do not hand-patch the generated file.

### First-time Codex setup on a clone

1. **Trust the project.** Codex loads project-scoped `.codex/config.toml` and `.codex/hooks.json`
   only for a trusted project. Answer yes to the trust prompt on first run in this directory.
2. **Approve the hooks.** Non-managed hooks require explicit trust: run `/hooks` in the TUI and
   approve the three rob-mcp entries. Trust is recorded against each script's **hash**, so editing
   a hook under `.claude/hooks/` requires re-approval. In CI use
   `codex --dangerously-bypass-hook-trust`.
3. **context7 authenticates under Codex.** `codex mcp add` detects OAuth on `mcp.context7.com` and
   opens a browser flow — unlike Claude Code, which uses the endpoint anonymously via `.mcp.json`.
   The generated `[mcp_servers.context7]` entry is correct either way; you just have to complete
   the login once (`codex mcp login context7`).

### Verifying it actually took

The authoritative check is what Codex puts in the model's context:

```bash
codex debug prompt-input | grep -c "Never hardcode market metrics"   # expect >= 1
```

If that returns 0, `AGENTS.md` is not being loaded — check project trust and the byte budget below.

### Adding a new asset

Add it under `.claude/` in the normal Claude Code format, then `bun run sync-codex`. The generator
picks up new rules only if you add the slug to `RULE_ORDER` in `scripts/sync-codex.ts`; agents,
skills, and MCP servers are discovered automatically. Deleting a source file removes its mirror on
the next run (orphan sweep).

---

## Part 2 — The portable recipe

What follows is harness knowledge, not repo knowledge. It is what you need to rebuild this adapter
somewhere else.

### The four differences that actually matter

Everything else is cosmetic. These four drive the whole design:

1. **Codex has no `@`-imports.** `AGENTS.md` cannot reference other files the way `CLAUDE.md` can.
   Anything Claude loads by reference — rules, imported context files — must be **inlined**. This
   is the single biggest reason a naive symlink `AGENTS.md -> CLAUDE.md` fails: it silently drops
   every rule.
2. **There is a hard byte budget.** Codex stops adding instruction files once the chain reaches
   `project_doc_max_bytes` (**32 KiB** default) and _truncates silently_. Inlining makes this easy
   to hit. Assert on it in the generator — a build error beats a mystery in which the last rule
   just stops applying.
3. **Hooks are near-identical; tool names are not.** Both harnesses feed hooks one JSON object on
   stdin and treat **exit 2 as "block, and show stderr to the model"**. So the _scripts_ port
   verbatim. What differs is the tool vocabulary and payload shape:

   |             | Claude Code                                        | Codex                                                                           |
   | ----------- | -------------------------------------------------- | ------------------------------------------------------------------------------- |
   | Shell tool  | `Bash`, `tool_input.command` is a **string**       | `shell` / `unified_exec`, `command` is an **argv array**                        |
   | File write  | `Write`/`Edit`/`MultiEdit`, `tool_input.file_path` | `apply_patch`, paths live inside the **patch body** (`*** Update File: <path>`) |
   | Config      | `.claude/settings.json`                            | `.codex/hooks.json` or `[hooks]` in `.codex/config.toml`                        |
   | Project dir | `$CLAUDE_PROJECT_DIR`                              | not set — derive it                                                             |

   Write the extraction preamble to accept **both** shapes and the script stays single-source. The
   matchers are regexes, so use permissive alternations like
   `(?i)^(bash|shell|unified_exec|exec_command|local_shell)$`.

4. **Skills are the same format.** Both read `SKILL.md` with `name` + `description` frontmatter.
   Codex scans `$REPO_ROOT/.agents/skills`, Claude scans `.claude/skills`. Because the format is
   identical, **symlink instead of copying** — it is the one asset class needing no translation.

### Secondary gotchas

- **Subagents are a real format change.** Claude: markdown + YAML frontmatter (`name`,
  `description`, `tools`). Codex: TOML in `.codex/agents/*.toml` with `name`, `description`,
  `developer_instructions`. Use a **TOML multi-line literal string** (`'''…'''`) for the body — it
  does no escape processing, so markdown passes through untouched. Guard against the body
  containing `'''`.
- **Tool allowlists do not survive.** Claude expresses "this agent may not write" by omitting
  `Write`/`Edit` from its `tools:` list. Codex has no per-agent allowlist. Restate the constraint
  **as prose** in `developer_instructions` — prose is the only mechanism guaranteed to survive the
  translation. Treat it as a soft guarantee, not enforcement, and keep the hard enforcement in
  hooks, which fire in both harnesses.
- **Hook trust is hash-pinned.** Editing a hook script silently disarms it in Codex until
  re-approved via `/hooks`. Worth knowing before you conclude a rule "stopped working".
- **Trust gates project config.** An untrusted project means Codex ignores `.codex/` entirely — no
  hooks, no MCP, no subagents. Silent, not an error.
- **Exclude generated files from your formatter.** Otherwise prettier rewrites the output, the
  drift check sees a diff, and `validate` fails forever. `.prettierignore` covers `AGENTS.md`,
  `.codex/`, `.agents/`.
- **Two H1s in AGENTS.md is fine.** Do not contort the structure to avoid it.

### Build order

1. Write the generator with a `--check` mode from the start; wire `--check` into the repo's
   validate/CI script and `--write` into a `sync` script. Drift detection is the whole point — a
   generator without it just creates a second file to forget about.
2. Make the hook scripts harness-agnostic **first** (accept both payload shapes), then point both
   harness configs at the same files. Resist copying them.
3. Symlink skills. Generate everything else.
4. Add an orphan sweep so deleting a source file removes its mirror.
5. Assert the byte budget.
6. Verify empirically with `codex debug prompt-input`, not by reading the generated file — the
   question is what the model receives, not what you wrote.

### Verification checklist

```bash
bun run sync-codex && bun run sync-codex --check   # idempotent?
codex debug prompt-input | grep -c "<a phrase from your innermost rule>"
ls -l .agents/skills/                              # symlinks, not copies?
printf '%s' '{"tool_name":"shell","tool_input":{"command":["bash","-lc","<blocked cmd>"]}}' \
  | ./.claude/hooks/<guard>.sh; echo "exit=$?"     # expect 2 for both harness shapes
```

Test each hook against **both** payload shapes plus a benign input. A guard that silently stops
matching is worse than no guard, and the failure is invisible from the outside.

### What this recipe deliberately does not do

- **No `.codex/agents/*.toml` sandbox or model pins.** `name`/`description`/`developer_instructions`
  are the fields with solid documentation. Optional keys (`model`, `model_reasoning_effort`,
  `sandbox_mode`, `mcp_servers`) appear in community write-ups but were not verified against the
  binary here — add them deliberately, not by default.
- **No AGENTS.md → CLAUDE.md direction.** Claude Code reads `AGENTS.md` only when no `CLAUDE.md`
  exists, and `.claude/rules/` has no Codex equivalent, so Claude is the richer source and the
  natural direction of generation.
