# Coordinator system

OpenCode starts with the `coordinator` primary agent. It delegates bounded work to hidden `coder`, `verifier`, `reviewer`, `inspector`, `researcher`, and `archivist` subagents. The built-in `build` and `plan` agents remain selectable.

Persistent memory lives in `~/.config/opencode/memory` as an independent Git repository. The configuration repository ignores that directory. The first `/ingest`, `/ask`, or `/lint` operation offers to initialize memory, connect an existing local or remote Git vault, or continue without memory. Nothing pushes memory commits automatically.

Available commands:

- `/ingest <source> [focus]` ingests a file, pasted text with a title, local repository, or repository URL. It checks source identity before analysis, requests operator approval for partial coverage, and removes temporary remote clones after use.
- `/ask <question>` combines indexed memory with verified live-project evidence.
- `/lint [--all]` checks memory structure, repairs safe index defects, and reports semantic conflicts.

Optional worker model and variant overrides use `OPENCODE_MODEL_<AGENT>` and `OPENCODE_VARIANT_<AGENT>`, for example `OPENCODE_MODEL_CODER=anthropic/claude-sonnet-4-6` and `OPENCODE_VARIANT_CODER=high`. These overrides apply to `archivist`, `coder`, `inspector`, `researcher`, `reviewer`, and `verifier`; empty variables preserve inheritance. `OPENCODE_SENSITIVE_TERMS` accepts a comma-separated list of additional text that must not enter worker task briefs. `OPENCODE_INGEST_CONCURRENCY` controls repository-ingest batching, defaults to four, and must be from 1 through 16.

Recommended capability-to-cost baseline:

```sh
export OPENCODE_MODEL_ARCHIVIST="openai/gpt-5.6-luna"
export OPENCODE_VARIANT_ARCHIVIST="medium"
export OPENCODE_MODEL_CODER="openai/gpt-5.6-terra"
export OPENCODE_VARIANT_CODER="high"
export OPENCODE_MODEL_INSPECTOR="openai/gpt-5.6-luna"
export OPENCODE_VARIANT_INSPECTOR="high"
export OPENCODE_MODEL_RESEARCHER="openai/gpt-5.6-terra"
export OPENCODE_VARIANT_RESEARCHER="medium"
export OPENCODE_MODEL_REVIEWER="openai/gpt-5.6-sol"
export OPENCODE_VARIANT_REVIEWER="medium"
export OPENCODE_MODEL_VERIFIER="openai/gpt-5.6-luna"
export OPENCODE_VARIANT_VERIFIER="medium"
```

Place these exports in the shell startup file used to launch OpenCode. The coordinator remains unset and follows the active session model.

Run `npm test` for deterministic plugin and resolved-configuration tests. Run `npm run check` for TypeScript validation. A live provider smoke test is manual:

1. Restart OpenCode so it loads configuration-time files.
2. Run `/ask what memory is available?` and verify one archivist task is created.
3. Choose whether to initialize, connect, or continue without memory.
4. Verify the coordinator cannot edit, the archivist cannot use Bash, and a task brief containing a test-shaped secret is rejected before delegation. Do not use a real credential.
