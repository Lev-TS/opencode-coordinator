# Coordinator agent and persistent memory system

## Problem Statement

The operator needs one primary OpenCode agent to own reasoning, coordinate specialist workers, and maintain durable knowledge without giving every worker access to every tool or piece of context.

The current global OpenCode configuration enables Playwright and Chrome DevTools MCP servers and restricts those tools for existing built-in agents. It does not define a custom primary coordinator, specialist workers, slash commands, persistent memory, or supporting plugins. The agent directory is empty, and the repository has no command, plugin, test, documentation, or ADR conventions to extend.

Without this system, implementation, review, verification, browser inspection, research, and memory maintenance do not have explicit ownership boundaries. Project knowledge can disappear with chat history or become stale when other people change a repository. Passing unrestricted context to workers also risks disclosing credentials or unrelated sensitive information.

The system must provide coordinated delegation, current-evidence checks, an operator-controlled Obsidian memory vault, and enforceable tool restrictions where OpenCode supports them. It must report uncertainty rather than invent repository state, results, sources, requirements, or intent.

## Solution

Install a global primary coordinator that becomes the default agent while preserving the existing `build` and `plan` agents as independently selectable agents. The coordinator performs the main reasoning, reads focused project context, and delegates bounded work to hidden specialist workers named `archivist`, `coder`, `inspector`, `researcher`, `reviewer`, and `verifier`.

The coordinator is the supported entry point for the workers. Workers cannot delegate. The coordinator cannot edit project files or run mutating project commands. It sends implementation work to `coder`, final validation to `verifier`, browser work to `inspector`, external evidence collection to `researcher`, a focused standards or specification review axis to `reviewer`, and all persistent-memory access to `archivist`.

Persistent memory is one global Obsidian vault under the global OpenCode configuration directory. The vault is an independent Git repository and is ignored by the parent configuration repository. It contains shared knowledge and isolated project namespaces. A sanitized Git remote identifies a project across machines; repositories without a remote use an operator-assigned identifier.

The operator interacts with memory through `/ingest`, `/ask`, and `/lint`. Ingest is explicit. Ask combines memory with live project evidence and requests approval before external research. Lint repairs mechanical defects and reports semantic conflicts. The archivist serializes memory changes and creates one local commit per successful operation through a dedicated commit tool. It never pushes automatically.

On a machine where the vault is absent, the first memory operation offers to initialize a conforming empty vault, connect an existing vault, or continue without memory. The system never overwrites or reinitializes a non-empty directory.

## User Stories

1. As an operator, I want the coordinator to be the default global agent, so that normal work starts with the agent responsible for reasoning and delegation.
2. As an operator, I want simple requests handled directly when delegation adds no value, so that coordination does not add unnecessary overhead.
3. As an operator, I want `build` and `plan` to remain independently selectable with their existing behavior, so that the new system does not remove established workflows.
4. As an operator, I want the coordinator to delegate only to the agreed specialist roster, so that worker responsibilities remain explicit.
5. As an operator, I want workers hidden from normal selection and autocomplete, so that the coordinator remains their supported entry point.
6. As an operator, I want workers unable to launch other workers, so that all follow-up decisions return to the coordinator.
7. As an operator, I want the coordinator prevented from editing project files, so that implementation changes always have one owner.
8. As an operator, I want the coordinator to run allowlisted read-only Git commands without interruption, so that it can identify repositories and inspect current state.
9. As an operator, I want other coordinator terminal commands to require permission and remain read-only, so that the coordinator cannot bypass the coder boundary.
10. As an operator, I want `coder` to inspect and modify the current project for assigned implementation work, so that code changes have a dedicated worker.
11. As an operator, I want `coder` to run focused implementation checks, so that it can iterate effectively while making a change.
12. As an operator, I want `verifier` to rerun final checks independently, so that coder-reported checks are not treated as final evidence.
13. As an operator, I want dependency additions, removals, and upgrades to require approval, so that implementation work does not silently change dependency or supply-chain risk.
14. As an operator, I want existing declared dependencies installable by normal project commands, so that routine setup does not require a new design decision.
15. As an operator, I want `verifier` to run unit tests, integration tests, lint checks, formatting checks, type checks, builds, and static analysis without editing source or configuration, so that validation remains independent.
16. As an operator, I want validation tools allowed to create normal caches, coverage data, and build output, so that read-only source validation remains practical.
17. As an operator, I want the verifier to avoid write-format modes, snapshot updates, and source mutation, so that validation does not alter the implementation under review.
18. As an operator, I want every verifier report to include commands, exit statuses, failures, evidence, and resulting worktree changes, so that the coordinator can assess the result.
19. As an operator requesting code review, I want the coordinator to delegate either standards compliance or specification compliance as a separate focused brief to `reviewer`, so that one review axis receives independent attention.
20. As an operator requesting code review, I want the coordinator to retain responsibility for correctness, regression analysis, synthesis, and the final review, so that the reviewer does not replace the parent review.
21. As an operator, I want `reviewer` limited to project reads, searches, and diagnostics, so that review cannot mutate or execute the project.
22. As an operator, I want `inspector` to use Playwright for interaction and reproduction, so that UI behavior can be exercised consistently.
23. As an operator, I want `inspector` to use Chrome DevTools for console, network, and performance evidence, so that browser diagnostics have a dedicated worker.
24. As an operator, I want `inspector` to read relevant UI source without editing it, so that browser evidence can be connected to selectors and components.
25. As an operator, I want `researcher` limited to web search and fetch tools, so that external evidence collection stays separate from project and memory access.
26. As an operator, I want research to prioritize primary and authoritative sources and use reputable secondary sources for corroboration, so that the coordinator receives high-trust evidence.
27. As an operator, I want research reports to include URLs, publication or update dates when available, and explicit uncertainty when sources conflict, so that current claims remain auditable.
28. As an operator, I want the coordinator to perform the analysis after receiving research, so that the researcher collects evidence rather than making the final decision.
29. As an operator, I want suspected credentials, tokens, passwords, private keys, session material, secret environment values, and operator-designated sensitive content excluded from worker prompts, so that delegation does not leak secrets.
30. As an operator, I want suspected secret-bearing delegation rejected rather than silently redacted, so that altered technical context is not passed as if complete.
31. As an operator, I want the coordinator to rewrite rejected briefs with explicit redaction labels, so that safe context can still reach a worker.
32. As an operator, I want one global Obsidian vault with separate project folders, so that memory remains browsable without mixing project-specific facts.
33. As an operator, I want shared preferences, concepts, procedures, and analyses stored outside project namespaces, so that genuinely reusable knowledge has one home.
34. As an operator, I want project knowledge resolved by sanitized Git remote, so that different checkouts of the same repository use the same namespace.
35. As an operator, I want an operator-assigned project identifier when no Git remote exists, so that non-remote repositories can still have stable memory.
36. As an operator, I want credentials and user information removed from remote URLs before storage, so that project identity cannot persist embedded secrets.
37. As an operator, I want mutable project claims tied to repository identity, commit SHA, file path, line range when available, and verification date, so that stale knowledge is detectable.
38. As an operator, I want live project evidence to control answers about current behavior, dependencies, configuration, and implementation, so that stale memory does not override the checkout.
39. As an operator, I want old claims marked superseded with old and new commit references, so that history remains understandable without relying only on Git history.
40. As an operator, I want durable decisions, preferences, architecture, recurring procedures, and important verified project facts persisted automatically, so that useful knowledge survives ordinary work.
41. As an operator, I want `do not remember this` to suppress persistence for the current request, so that I can prevent an otherwise durable fact from entering memory.
42. As an operator, I want transient command output, temporary failures, routine file state, and ordinary answers excluded from durable notes, so that the vault does not become chat history.
43. As an operator, I want automatic memory updates to report changed pages, reasons, and commit hashes, so that persistence remains visible.
44. As an operator, I want only the archivist to read, search, edit, and commit memory through supported tools, so that memory ownership remains narrow.
45. As an operator, I want outside evidence passed to the archivist by the coordinator, so that the archivist does not need project, browser, web, or general terminal access.
46. As an operator, I want memory operations queued and processed one at a time, so that overlapping edits and commits do not corrupt the vault.
47. As an operator, I want one local memory commit per successful ingest, lint repair, ask log, stale-memory repair, or durable update, so that each operation is auditable.
48. As an operator, I want memory commits created by a dedicated tool confined to the vault, so that the archivist does not receive a general shell.
49. As an operator, I want memory commits kept local unless I push them, so that synchronization stays under operator control.
50. As an operator, I want commit failures reported with dirty files and the exact Git error, so that valid changes are not destroyed by an automatic reset.
51. As an operator, I want `/ingest` to accept Markdown files, text files, pasted text, local repositories, and repository URLs, so that I can supply several forms of context explicitly.
52. As an operator, I want pasted text to require a title and retain a content hash, so that its source identity remains usable without a raw copy.
53. As an operator, I want ingest to leave source files and repositories unmodified, so that external evidence remains under its original owner's control.
54. As an operator, I want ingest to retain provenance, a content hash or commit SHA, a structured summary, citations, and short supporting excerpts, so that claims remain auditable without a raw-source directory.
55. As an operator, I want unchanged sources detected before updating the vault, so that repeated ingest produces no vault change or empty commit.
56. As an operator, I want repository ingest to map architecture, conventions, major components, and requested topics rather than summarize every file, so that the result remains useful and maintainable.
57. As an operator, I want repository ingest to exclude secrets, ignored files, dependencies, generated output, binaries, caches, and version-control internals by default, so that unsafe or irrelevant content is not processed.
58. As an operator, I want skipped categories reported and safe exclusions includable explicitly, so that ingest coverage is visible without permitting secret-file overrides.
59. As an operator, I want remote repository cloning to require approval with the destination and network action disclosed, so that ingest does not silently fetch code.
60. As an operator, I want a large repository mapped before batching, so that the coordinator can state why batching is required.
61. As an operator, I want the coordinator to report the estimated batch count and scope before starting a large ingest, so that I understand the planned work.
62. As an operator, I want each ingest batch assigned to a separate coder invocation and batches processed in parallel, so that large repository analysis completes efficiently.
63. As an operator, I want ingest concurrency limited to four by default and configurable through `OPENCODE_INGEST_CONCURRENCY`, so that provider and machine load remain bounded.
64. As an operator, I want partial batch failures retried when transient and reported, so that the vault does not silently claim complete coverage.
65. As an operator, I want no memory update after batch failure unless all batches succeed or I approve explicitly marked partial coverage, so that incomplete evidence cannot appear complete.
66. As an operator, I want `/ask` to search memory and verify mutable claims against the live project, so that answers combine historical context with current evidence.
67. As an operator, I want focused project checks handled by the coordinator and broad multi-file investigations delegated to `coder`, so that repository reading is proportionate to the question.
68. As an operator, I want `/ask` to request approval before external research when memory and project evidence are insufficient, so that web use remains explicit.
69. As an operator, I want `/ask` responses to distinguish memory evidence, current-project evidence, external evidence, contradictions, and unknowns, so that sources are not conflated.
70. As an operator, I want ask logs to record a timestamp, normalized topic, evidence categories, and pages consulted without copying the full conversation, so that queries are auditable without persisting unnecessary content.
71. As an operator, I want `/lint` to inspect the current project namespace and referenced shared pages by default, so that routine maintenance remains focused.
72. As an operator, I want `/lint --all` to inspect the entire vault, so that global maintenance is available explicitly.
73. As an operator, I want lint to repair broken links, stale index entries, malformed metadata, and other mechanical defects automatically, so that safe maintenance does not require repeated approval.
74. As an operator, I want lint to report contradictions, unsupported conclusions, and semantic conflicts instead of rewriting them silently, so that knowledge is not erased or reinterpreted without judgment.
75. As an operator, I want memory claims labeled `verified`, `synthesis`, `hypothesis`, `contradiction`, `unknown`, or `superseded`, so that evidence and interpretation remain distinct.
76. As an operator, I want human-readable page names inside project-qualified paths, so that Obsidian links remain readable without colliding across projects.
77. As an operator, I want standard Markdown and Obsidian wikilinks without required plugins, so that the vault works in Obsidian and plain-text tools.
78. As an operator, I want restrained frontmatter for page type, updated date, and source references, so that lint and provenance have structured fields without an excessive schema.
79. As an operator, I want `index.md` to catalog memory content and be consulted first by the archivist, so that navigation has a stable entry point.
80. As an operator, I want `log.md` append-only with consistent machine-readable headings, so that ingest, ask, lint, and maintenance history remains inspectable.
81. As an operator, I want no `raw/` directory, so that the vault stores synthesized knowledge rather than copies of operator sources.
82. As an operator on a new machine, I want the configuration to work without copying or advertising my memory repository, so that configuration and memory remain independently portable.
83. As an operator on a new machine, I want the first memory operation to offer initialization, connection to an existing vault, or continuation without memory, so that absence is handled deliberately.
84. As an operator initializing memory, I want the required schema, indexes, log, shared namespace, project registry, ignore rules, and independent Git repository created with an initial commit, so that the vault is immediately usable.
85. As an operator connecting existing memory, I want its structure validated before any changes, so that incompatible or incomplete vaults are not silently rewritten.
86. As an operator, I want a non-empty memory directory never overwritten or reinitialized, so that existing data remains safe.
87. As an operator, I want worker models to inherit the active coordinator model by default, so that configuration does not require model variables on every machine.
88. As an operator, I want `OPENCODE_MODEL_<AGENT>` and `OPENCODE_VARIANT_<AGENT>` values applied only when present, so that individual workers can use machine-specific model and variant overrides without empty values breaking startup.
89. As an operator, I want all agents to avoid invented facts, repository state, behavior, commands, sources, citations, requirements, and intent, so that decisions rest on evidence.
90. As an operator, I want useful unverified possibilities labeled as hypotheses, so that uncertainty is explicit before material actions.
91. As an operator, I want failed operations to stop, preserve successful evidence, and report exact failures, so that the coordinator does not claim unsupported success.
92. As an operator, I want one automatic retry only for clearly transient provider or transport failures, so that retry behavior is bounded.

## Implementation Decisions

### Agent topology

- Define one custom primary coordinator and make it the global default agent.
- Preserve the current `build` and `plan` agents as independently selectable agents. Do not route coordinator work through them.
- Define `archivist`, `coder`, `inspector`, `researcher`, `reviewer`, and `verifier` as hidden subagents.
- Restrict the coordinator's task permission to the six named workers. Deny task delegation for every worker.
- Keep the coordinator as the only component that combines worker evidence and communicates final conclusions to the operator.
- Keep current built-in browser-tool restrictions unless an agreed custom-agent permission requires otherwise. Do not introduce a top-level permission policy that changes built-in behavior.

### Responsibility boundaries

- The coordinator performs primary reasoning, focused project reads, result analysis, stale-memory detection, and final responses.
- The coordinator may directly answer simple requests. It delegates when implementation, broad repository inspection, browser interaction, external research, independent review, independent verification, or persistent memory is required.
- The coder owns project source and configuration edits. It may run focused checks while implementing. Those checks are not final verification.
- The verifier independently runs non-mutating validation and reports exact commands and outcomes. Edit tools remain denied. Validation commands may create ordinary generated artifacts but must not update source, snapshots, or formatting in write mode.
- The reviewer receives one focused standards or specification-compliance brief for each parent code review. The coordinator handles the other review axes and produces the final review.
- The inspector uses Playwright for interaction and reproduction and Chrome DevTools for console, network, and performance evidence. It may read relevant project files but cannot edit or execute project commands.
- The researcher gathers current external evidence from high-trust sources. It does not read the project, inspect the browser, access memory, or perform the coordinator's final analysis.
- The archivist alone reads, searches, edits, lints, and commits the memory vault. It receives structured evidence and provenance from the coordinator rather than reading projects or the web.

### Effective permissions

| Agent | Allowed capabilities | Denied capabilities |
|---|---|---|
| Coordinator | Project read and search, diagnostics, allowlisted read-only Git commands, permission requests for additional read-only commands, six named workers | Project edits, mutating commands, browser MCP tools, web tools, direct memory access |
| Coder | Project read, search, edit, terminal, and diagnostics | Memory, browser MCP tools, web search, worker delegation |
| Inspector | Project read and search, Playwright, Chrome DevTools | Project edits, terminal, web research, memory, worker delegation |
| Researcher | Web search and fetch | Project files, terminal, browser MCP tools, memory, worker delegation |
| Reviewer | Project read and search, diagnostics | Project edits, terminal, browser MCP tools, web tools, memory, worker delegation |
| Verifier | Project read and search, diagnostics, validation commands | Edit tools, browser MCP tools, web tools, memory, worker delegation |
| Archivist | Vault read, search, edit, lint operations, and dedicated memory commit | Project files, general terminal, browser MCP tools, web tools, worker delegation |

- Allow the coordinator read-only Git operations needed for status, diffs, history, repository roots, remotes, branches, and commit identities.
- Configure other coordinator terminal operations to ask. Its prompt must prohibit requesting mutating commands and direct those operations to the coder.
- Permit existing declared dependencies to be installed through normal project commands. Require operator approval before adding, removing, or upgrading dependencies.
- Treat these controls as practical workflow enforcement, not hostile process isolation. OpenCode agents share an OS user and process environment. Bash-capable agents cannot be proven unable to reach every same-user path without an external sandbox.

### Secret protection

- Add a plugin guard at coordinator-to-worker task execution.
- Inspect worker prompts for recognizable credentials, private-key blocks, tokens, passwords, cookies, session material, secret assignments, and operator-designated sensitive material.
- Reject suspected secret-bearing delegation. Do not silently redact or provide an override that sends the original value.
- Require the coordinator to rewrite the brief with explicit placeholders before retrying.
- Combine prompt filtering with per-agent tool permissions. Do not claim that pattern matching detects every possible secret.

### Model selection

- Leave the coordinator model unset so it inherits the active session model.
- Let workers inherit the invoking coordinator model by default.
- During plugin configuration, apply `OPENCODE_MODEL_<AGENT>` and `OPENCODE_VARIANT_<AGENT>` to a worker only when the corresponding variable is non-empty.
- Do not depend on `.env` loading for model selection and do not place environment substitutions in Markdown agent frontmatter.
- Use this capability-to-cost profile as the recommended initial deployment baseline. It is operator configuration, not a checked-in default.

| Agent | Recommended model | Variant | Rationale |
|---|---|---|---|
| Archivist | `openai/gpt-5.6-luna` | `medium` | Economical structured memory work with enough reasoning for validation and synthesis |
| Coder | `openai/gpt-5.6-terra` | `high` | Strong implementation capability without using the flagship tier for every edit |
| Inspector | `openai/gpt-5.6-luna` | `high` | Cost-efficient browser evidence collection with added effort for diagnosis |
| Researcher | `openai/gpt-5.6-terra` | `medium` | Balanced source discovery, conflict resolution, and multi-source synthesis |
| Reviewer | `openai/gpt-5.6-sol` | `medium` | Flagship judgment reserved for nuanced defect and regression analysis |
| Verifier | `openai/gpt-5.6-luna` | `medium` | Economical execution and interpretation of bounded validation checks |

### Memory vault and schema

- Use one global Obsidian vault named `memory` under the global OpenCode configuration directory.
- Make the vault an independent Git repository. Ignore it from the parent configuration repository. Do not configure or advertise a vault remote automatically.
- Do not require Obsidian plugins, Dataview, embeddings, or hybrid search.
- Ignore machine-specific Obsidian workspace state.
- Initialize an operating contract, content index, append-only operation log, shared namespace, project index, and project registry.
- The shared namespace contains operator preferences and cross-project concepts, procedures, entities, and analyses where applicable.
- Each registered project receives isolated pages for its overview, decisions, architecture, concepts, entities, sources, and analyses as those page types become necessary.
- Use human-readable filenames inside project-qualified paths. Use path-qualified wikilinks when titles could collide.
- Use restrained frontmatter for page type, updated date, and source references.
- Label material claims as `verified`, `synthesis`, `hypothesis`, `contradiction`, `unknown`, or `superseded`.
- Keep `index.md` readable in plain Markdown and list every maintained page with a link and short description.
- Keep `log.md` chronological and append-only with consistent machine-readable headings for successful ingests, asks, lint passes, stale-memory repairs, and durable updates.
- Do not create a `raw/` directory.

### Project identity and freshness

- Use a sanitized Git remote URL as the stable project identity. Remove embedded credentials and user information before persistence.
- Record observed local paths as non-authoritative aliases.
- Ask the operator for a stable identifier when a repository has no remote.
- Treat multiple checkouts with the same stable remote as the same project. Record branch and commit observations separately.
- Treat a different commit as evidence that mutable memory may be stale, not proof that the old claim was false.
- Verify mutable project claims against the live checkout before using them in an answer.
- When live evidence conflicts with memory, answer from live evidence, report the conflict, and delegate a memory correction.
- Update the current claim and preserve the previous claim in a superseded section with old and new provenance.
- Promote project knowledge into the shared namespace only when it genuinely applies across projects.

### Memory lifecycle and Git

- Queue memory operations and execute them serially.
- Provide a dedicated memory commit tool rather than general archivist Bash access.
- Confine the tool to the configured vault root, reject escaping paths, stage only vault changes, create one local commit, and return the commit hash or exact failure.
- Never push automatically.
- Create one commit for each successful ingest, lint repair, ask log, stale-memory repair, or ordinary durable update.
- Do not create a commit for an unchanged ingest.
- On commit failure, report the dirty files and Git error. Do not automatically reset or discard changes.
- Report every automatic memory update with changed pages, reason, and commit hash.

### Vault provisioning

- When a memory operation finds no vault, offer three choices: initialize a new vault, connect an existing vault, or continue without memory.
- Initialization creates the agreed schema and an independent Git repository with an initial commit.
- Never overwrite or reinitialize a non-empty directory.
- Connecting an existing vault validates its schema before mutation and reports missing or incompatible components.
- The global OpenCode configuration must continue to load when the vault is absent.

### Ingest workflow

- Implement `/ingest` as an operator-invoked command routed through the coordinator.
- Support local Markdown and text paths, pasted text with a title, local repository paths, and repository URLs. Support an optional focus describing what to investigate.
- Read external inputs without modifying them.
- Keep no raw source copy. Store provenance, a content hash or repository commit, structured summaries, citations, and short supporting excerpts.
- Check source identity before processing. If the same hash or commit is already ingested, report the existing record and make no vault change or commit.
- For repository URLs, disclose the network operation and clone destination and obtain approval before cloning.
- Exclude secret files, ignored files, dependencies, generated output, binaries, caches, and version-control internals by default.
- Report excluded categories. Allow explicitly safe excluded paths to be included, but never override secret-file exclusions.
- Map repository architecture, conventions, major components, and operator-requested topics. Do not claim to summarize every source file.
- If the repository is too large for one bounded inspection, report the reason, estimated batch count, batch scopes, and configured concurrency before starting.
- Assign each batch to a separate coder invocation. Run up to four batches in parallel by default. Read `OPENCODE_INGEST_CONCURRENCY` as an optional concurrency override.
- Combine batch evidence before sending one structured memory update to the archivist.
- Retry clearly transient provider or transport failures once.
- If a batch still fails, do not update memory unless all batches later succeed or the operator approves explicitly marked partial coverage.

### Ask workflow

- Implement `/ask` as an operator-invoked command routed through the coordinator.
- Have the archivist consult the content index first and return relevant memory evidence with provenance.
- Verify mutable project claims against the live checkout. The coordinator handles focused reads; broad or multi-file investigation goes to the coder.
- If memory and project evidence remain insufficient, request approval before delegating external research.
- Separate memory evidence, live project evidence, external evidence, contradictions, and unknowns in the final response.
- Append a query log containing timestamp, normalized topic, evidence categories, and pages consulted. Do not copy the full question and answer by default.
- Persist a durable answer or newly verified fact only when it meets the agreed durable-memory criteria.

### Lint workflow

- Implement `/lint` as an operator-invoked command routed through the coordinator and delegated to the archivist.
- By default, inspect the current project's namespace and referenced shared pages. Use `/lint --all` for the whole vault.
- Check broken or missing links, orphan pages, duplicate concepts, stale indexes, missing provenance, malformed metadata, malformed logs, contradictory claims, superseded claims, unsupported synthesis, uncataloged pages, missing concepts, and useful knowledge gaps.
- Automatically fix mechanical defects such as broken links, stale indexes, and malformed metadata when the correct repair is unambiguous.
- Report semantic conflicts, factual contradictions, and uncertain merges. Do not erase or reinterpret them silently.
- Append and commit the lint result when the operation changes or records vault state.

### Ordinary memory updates

- At the end of normal work, identify durable operator decisions, preferences, architecture, recurring procedures, and important verified project facts.
- Exclude routine output, temporary failures, transient file state, speculation, and ordinary answers.
- Honor `do not remember this` for the current request.
- Delegate qualifying updates to the archivist with provenance and secret-free context.

### Failure behavior

- Stop an affected operation after a non-transient worker or tool failure.
- Preserve successfully gathered evidence but do not convert incomplete evidence into an unsupported claim.
- Report the failed worker or tool, exact error, completed scope, incomplete scope, and whether memory changed.
- Retry only clearly transient provider or transport failures, at most once.
- Do not silently continue with missing ingest batches, failed validation, missing citations, unavailable memory, or rejected secret-bearing delegation.

## Testing Decisions

### Externally observable behavior

Tests must verify resolved OpenCode behavior rather than snapshots of configuration source or exact model prose. They must cover agent discovery, default selection, command routing, delegation boundaries, effective permissions, plugin behavior, vault effects, Git effects, and representative failure paths.

### Confirmed testing seams

1. **Resolved OpenCode configuration.** Use the real OpenCode 1.18.25 configuration loader through its debug commands. Verify the resolved coordinator, workers, commands, plugin registration, model behavior, hidden modes, task allowlists, and effective permissions. Inspect each distinct permission profile rather than duplicating identical assertions.
2. **Plugin public contract.** Import and instantiate the plugin against a temporary vault. Invoke public hooks and custom tools directly. Verify optional model overrides, secret-bearing task rejection, vault initialization, non-empty-directory protection, path confinement, serialized commits, local-only Git behavior, and commit-failure reporting.
3. **Thin live command smoke.** Run one representative slash command through the real CLI and inspect structured events, child sessions, and filesystem effects. Verify coordinator routing, one worker delegation, plugin participation, and one representative denied action. If provider credentials are unavailable, retain this as a documented manual smoke test rather than a flaky automated test.

### Important cases

- Configuration loads with the memory vault absent.
- The coordinator resolves as the default primary agent.
- Workers resolve as hidden subagents and cannot delegate.
- Existing `build` and `plan` behavior remains available.
- Each agent receives its agreed browser, web, edit, Bash, task, and memory permissions.
- Absent worker model and variant environment variables preserve inheritance; present variables override only that worker.
- A suspected secret blocks task delegation and no child worker receives the original prompt.
- A safe redacted brief can be delegated after rejection.
- New-vault initialization creates the schema and initial Git commit.
- Initialization rejects a non-empty directory.
- Existing-vault connection validates before mutation.
- The memory commit tool rejects paths outside the vault and never pushes.
- Concurrent memory requests serialize into distinct commits.
- A commit failure leaves changes visible and reports the exact failure without resetting.
- Re-ingesting an unchanged source creates no memory commit.
- A failed ingest batch creates no complete-memory update without explicit partial-coverage approval.
- `/ask` distinguishes memory, live-project, and external evidence.
- `/lint` repairs an unambiguous mechanical defect but reports a semantic contradiction.
- A representative denied action produces no forbidden side effect.

### Existing prior art

- The repository has no local test framework or test conventions.
- Use OpenCode's real configuration loader instead of adding a duplicate schema or frontmatter parser test.
- Follow OpenCode's plugin testing pattern of loading a plugin and asserting mutations at the published hook output boundary.
- Use structured command events and filesystem or Git state for the live smoke test rather than exact language-model output.

### What not to test

- Do not snapshot complete prompts, complete resolved configurations, or the entire plugin hook object.
- Do not test OpenCode's permission matcher, JSONC parser, Markdown frontmatter parser, or command argument expansion independently.
- Do not assert private helper call order when the public plugin boundary verifies the same result.
- Do not make broad language-model prose assertions.
- Do not claim OS-level isolation through tests of OpenCode permissions.
- Do not duplicate every deterministic plugin case in the live command smoke.

## Out of Scope

- A `raw/` source directory or full copies of ingested sources.
- Automatic file watching, scheduled ingestion, repository hooks, or ingestion not explicitly initiated by the operator.
- Summarizing every file in a repository.
- Silent external research or silent remote repository cloning.
- Automatic dependency additions, removals, or upgrades.
- Direct project edits or mutating terminal commands by the coordinator.
- Final validation performed only by the coder.
- Full code review delegated to the reviewer.
- Heavy analysis or final conclusions produced by the researcher.
- Direct project, web, browser, or general shell access for the archivist.
- Worker-to-worker delegation.
- Supported direct worker invocation as a normal workflow.
- Automatic Git push or automatic memory-remote configuration.
- A Git submodule for the memory vault.
- Copying the memory repository when the configuration repository is cloned.
- Automatic rollback or reset after a failed memory commit.
- Silent acceptance of partial ingest coverage.
- Numerical confidence scores.
- Required Obsidian plugins, Dataview, embeddings, hybrid search, or non-Markdown output formats.
- Absolute security isolation between agents sharing the same OS user. Achieving that requires an external sandbox or separate OS identities.
- Changing established `build` and `plan` behavior.
- Creating or configuring an issue tracker, Git remote, or issue label.

## Resolved Implementation Choices

1. **Coordinator configuration identifier.** Use `coordinator` as the custom primary agent key and set it as the global `default_agent`.
2. **Plugin SDK version target.** Pin `@opencode-ai/plugin` to 1.18.25 to match the installed OpenCode 1.18.25 runtime.
3. **Existing-vault connection input.** Accept both local Git repositories and Git URLs. Clone into `~/.config/opencode/memory` only after operator approval, use existing SSH or Git credential configuration, reject credential-bearing URLs, and refuse to modify a non-empty destination.
4. **Content hash algorithm.** Use SHA-256 over the exact source bytes for files and pasted text.
5. **Test runner and TypeScript setup.** Use Node 24's built-in `node:test` runner with TypeScript and `@types/node`. Do not add a separate test framework.

## Further Notes

- The specification derives from the operator-approved design and the current repository state. The repository has no pre-existing coordinator, custom worker, command, plugin, test, documentation, or ADR implementation to preserve.
- The current configuration already enables Playwright and Chrome DevTools MCP servers and denies their tools to configured built-in agents. Custom inspector permissions must be added without broad top-level permission changes.
- OpenCode loads configuration-time changes only at startup. Implementation and rollout instructions must require restarting OpenCode after agent, command, plugin, skill, or configuration changes.
- Permission rules are order-sensitive and use last-match-wins behavior. Broad rules must precede narrow exceptions.
- Direct user invocation of a known subagent can bypass the coordinator's task allowlist. Hidden workers reduce normal discoverability but are not an authorization boundary.
- Read and edit path rules do not cover every access route. Bash, grep, glob, LSP, MCP tools, attachments, and coordinator-supplied prompts require separate controls.
- The secret-filter plugin reduces accidental disclosure. It cannot prove that arbitrary text contains no secret.
- The memory vault omits the source specification's immutable raw-source layer. Hashes, commit SHAs, stable URLs, paths, citations, and selected excerpts therefore carry more provenance responsibility.
- Git history supplements `log.md`; it does not replace source provenance or operation logging.
- The configuration repository has no Git remote or issue tracker destination, so this specification remains a repository Markdown document.
