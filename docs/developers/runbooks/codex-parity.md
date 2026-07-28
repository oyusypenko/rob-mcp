# Runbook: Claude Code ↔ OpenAI Codex behavioral parity

**Design authority:** D-9 + D-10 in `design-decisions.md`.
**Generator:** `scripts/sync-codex.ts`.
**Verifier:** `scripts/verify-codex-parity.ts`.

This repo is maintained for two agent harnesses from one hand-edited source. Part 1 is how to
operate it here. Part 2 is the portable recipe — read that if you are rebuilding this adapter in
another repo.

> Verified against **codex-cli 0.144.6** and **Claude Code** on **2026-07-28**. “Parity” here means
> equivalent behavior for the assets this repo declares, not every feature either product ships.
> Both lines move fast; the pinned version + parity verifier prevent silent semantic drift.

---

## Part 1 — Operating it here

### The invariant

`.claude/**` and `.mcp.json` are the **only** hand-edited harness files. Everything Codex reads is
generated:

| Concern      | Source (edit this)      | Generated (never edit) | Mechanism                        |
| ------------ | ----------------------- | ---------------------- | -------------------------------- |
| Instructions | `CLAUDE.md`             | `AGENTS.md`            | concatenate + inline rules       |
| Rules        | `.claude/rules/*.md`    | inlined into AGENTS.md | headings demoted, text as-is     |
| Subagents    | `.claude/agents/*.md`   | `.codex/agents/*.toml` | body → `developer_instructions`  |
| Skills       | `.claude/skills/*/`     | `.agents/skills/*`     | **symlink** (one copy on disk)   |
| Hooks        | `.claude/hooks/*.sh`    | `.codex/hooks.json`    | **same scripts**, both harnesses |
| MCP          | `.mcp.json`             | `.codex/config.toml`   | `[mcp_servers.<name>]`           |
| Permissions  | `.claude/settings.json` | `.codex/config.toml`   | permission-profile translation   |
| Shell policy | `.claude/settings.json` | `.codex/rules/*.rules` | exec-policy translation          |

### Daily use

```bash
bun run sync-codex           # regenerate the Codex mirror
bun run sync-codex --check   # fail if stale (runs inside `bun run validate`)
bun run codex:parity         # prove runtime/config/hook/policy behavior
```

The pre-commit hook regenerates the mirror, then stops if that produced unstaged generated changes
so they can be reviewed and staged. CI is read-only: `bun run validate` fails on drift rather than
rewriting the checkout. If validate reports `codex mirror: STALE`, run `bun run sync-codex` and
commit the result; do not hand-patch generated files.

### First-time Codex setup on a clone

1. Run `bun run codex:setup`. It regenerates the mirror, verifies the supported Codex version,
   installs this repo's Git hook path, runs the parity verifier, and reports remaining interactive
   actions without reading or printing any secret.
2. **Trust the project.** Codex loads project-scoped `.codex/config.toml` and `.codex/hooks.json`
   only for a trusted project. Answer yes to the trust prompt on first run in this directory.
3. **Approve the hooks.** Non-managed hooks require explicit trust: run `/hooks` in the TUI and
   approve the three rob-mcp entries. Trust is recorded against each script's **hash**, so editing
   a hook under `.claude/hooks/` requires re-approval. In CI use
   `codex --dangerously-bypass-hook-trust`.
4. **Configure Context7 quota.** Export `CONTEXT7_API_KEY` locally for higher provider limits.
   Codex's generated `env_http_headers` reads it without committing it. If absent, the endpoint can
   still be used anonymously, but the setup check warns because anonymous quota may be exhausted.

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

1. **Codex has no instruction-assembly `@` imports.** `AGENTS.md` may point the agent to supporting
   files, but Codex does not eagerly inline Claude's `@path` syntax or auto-load `.claude/rules/`.
   Always-on imported content must therefore be generated inline. This is the biggest reason a
   naive symlink `AGENTS.md -> CLAUDE.md` fails: it silently drops every imported rule.
2. **There is a hard byte budget.** Codex stops adding instruction files once the chain reaches
   `project_doc_max_bytes` (**32 KiB** default) and _truncates silently_. Inlining makes this easy
   to hit. Assert on it in the generator — a build error beats a mystery in which the last rule
   just stops applying.
3. **Hooks are near-identical; tool names are not.** Both harnesses feed hooks one JSON object on
   stdin and treat **exit 2 as "block, and show stderr to the model"**. So the _scripts_ port
   verbatim. What differs is the tool vocabulary and payload shape:

   |             | Claude Code                                        | Codex                                                                             |
   | ----------- | -------------------------------------------------- | --------------------------------------------------------------------------------- |
   | Shell tool  | `Bash`, `tool_input.command` is a **string**       | canonical `Bash`, `tool_input.command` is a **string**; adapters may expose `cmd` |
   | File write  | `Write`/`Edit`/`MultiEdit`, `tool_input.file_path` | `apply_patch`, paths live inside the **patch body** (`*** Update File: <path>`)   |
   | Config      | `.claude/settings.json`                            | `.codex/hooks.json` or `[hooks]` in `.codex/config.toml`                          |
   | Project dir | `$CLAUDE_PROJECT_DIR`                              | not set — derive it                                                               |

   Keep the extraction preamble tolerant of the historical argv-array/`cmd` shapes so the shared
   script remains portable across Codex surfaces. Match canonical names plus known aliases.

4. **Skills are the same format.** Both read `SKILL.md` with `name` + `description` frontmatter.
   Codex scans `$REPO_ROOT/.agents/skills`, Claude scans `.claude/skills`. Because the format is
   identical, **symlink instead of copying** — it is the one asset class needing no translation.

### Secondary gotchas

- **Subagents are a real format change.** Claude: markdown + YAML frontmatter (`name`,
  `description`, `tools`). Codex: TOML in `.codex/agents/*.toml` with `name`, `description`,
  `developer_instructions`. Use a **TOML multi-line literal string** (`'''…'''`) for the body — it
  does no escape processing, so markdown passes through untouched. Guard against the body
  containing `'''`.
- **General tool allowlists do not survive.** Codex has no general equivalent to Claude's
  per-agent `tools:` list. For the security property this repo needs, omission of write tools is
  translated into `default_permissions = ":read-only"` plus prose defense in depth. MCP servers
  and web search can be narrowed with Codex config, but arbitrary built-in tool sets cannot.
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
6. Translate Claude permission and Bash-policy entries into Codex permission profiles and rules.
7. Verify empirically with `codex debug prompt-input`, not by reading the generated file — the
   question is what the model receives, not what you wrote.

### Verification checklist

```bash
bun run sync-codex && bun run sync-codex --check   # idempotent?
bun run codex:parity
codex debug prompt-input | grep -c "<a phrase from your innermost rule>"
ls -l .agents/skills/                              # symlinks, not copies?
printf '%s' '{"tool_name":"shell","tool_input":{"command":["bash","-lc","<blocked cmd>"]}}' \
  | ./.claude/hooks/<guard>.sh; echo "exit=$?"     # expect 2 for both harness shapes
```

Test each hook against **both** payload shapes plus a benign input. A guard that silently stops
matching is worse than no guard, and the failure is invisible from the outside.

### Upstream boundaries

- **No false product-parity claim.** Codex still lacks native Claude-style `@` imports, general
  per-agent built-in-tool allowlists, several Claude hook events/handler types, and reliable named
  custom-agent selection on every tool-backed surface. The verifier covers this repo's declared
  behavior; it cannot add missing upstream product features.
- **No secret material in git.** Context7's key is read from `CONTEXT7_API_KEY`; the generated
  config stores only the environment-variable name.
- **No AGENTS.md → CLAUDE.md direction.** Claude Code reads `AGENTS.md` only when no `CLAUDE.md`
  exists, and `.claude/rules/` has no Codex equivalent, so Claude is the richer source and the
  natural direction of generation.
