# The agent harness

A pattern for turning a general-purpose coding agent into a configured, least-privilege team with durable memory.

This is an idea file. It is designed to be copy-pasted to your own agent (Claude Code, OpenAI Codex, OpenCode, Cursor, Aider, or whatever you run). Its goal is to communicate the high level idea. Your agent will build out the specifics in collaboration with you, in your runtime, against your preferences.

## The core idea

Most people run an agent the way it ships. One agent, every tool enabled, a fresh context window every session. You re-explain your conventions on Monday that you already explained on Friday. The same agent that wrote the code also tells you the code is correct. It can edit your files, install packages, browse the web, and read your `.env`, all under one prompt and one permission set. This works, and it is where everyone starts.

The idea here is different. Treat the agent runtime as something you *configure* rather than something you *use*. You write down a **roster of roles**, give each role only the tools its job actually requires, name your recurring workflows as commands, and give the whole thing a memory that outlives the chat. The result is a harness: a version-controlled directory that turns a general model into your particular team.

This is the key difference: **the harness is a persistent, compounding artifact.** Your conventions live in a file instead of in your memory of what you told it last time. The review boundary exists in configuration instead of in your discipline about remembering to ask for a review. A workflow you refined over three weeks becomes a command that you can invoke correctly on a Friday afternoon when you are tired and not thinking carefully.

You write very little of this yourself. You describe the boundaries you want, and the agent writes the configuration, the role prompts, the commands, and the tests, then runs inside them. Your job is to decide what the boundaries *are*: which work needs an independent second opinion, which tools are dangerous in which hands, what deserves to be remembered. There is something pleasing, and slightly uncomfortable, about having the agent build the thing that constrains it. It is also the only practical way to do it, because the agent knows its own runtime's configuration format better than you do.

This applies in a lot of contexts. A few examples:

- **Solo development**: a coordinator that reasons and delegates, an implementer that edits, and a verifier that reruns the checks independently. The point is that the thing declaring success is not the thing that wrote the code.
- **Research and analysis**: a researcher restricted to web tools, an archivist restricted to a knowledge vault, and a coordinator that does the synthesis. Evidence gathering and judgment are kept separate on purpose.
- **Operations and on-call**: read-only inspection roles with an explicit approval gate before anything mutates. The gate is the configuration, not a promise in a prompt.
- **Writing and editing**: a drafter, a line editor with a house-style document, and a fact-checker with source access. Style rules stop being something you paste at the top of every session.
- **Teams**: the harness is a repository. Conventions, review axes, and command workflows get reviewed like code, and new people get the accumulated setup on clone.

## Architecture

There are four layers, plus an optional fifth.

**The roster** is the set of roles. One primary agent that you talk to, and a set of specialist subagents it delegates to. The primary owns the reasoning and the final answer. Specialists do bounded work and return evidence. Roles are usually hidden from normal selection so the primary stays the supported way in.

**The permission table** is what each role may read, write, run, and fetch. This is where the roster becomes real. A role is not defined by the adjectives in its prompt, it is defined by what happens when it tries to call a tool. A reviewer that *could* edit files is a reviewer only by good intentions.

**Persistent memory** is durable knowledge that survives the chat: decisions, architecture, preferences, verified facts, recurring procedures. Usually a directory of interlinked markdown, usually its own Git repository, usually owned by exactly one role. See the memory section below, and see [llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) for a much deeper treatment of the knowledge-base side of this.

**Commands** are your workflows with names. A command is a stored prompt plus the role it runs as. Anything you have typed out three times in slightly different words belongs here, because the fourth time you will phrase it worse.

**The enforcement layer** is optional and comes last. Some rules cannot be expressed in configuration: inspecting a delegation before it is sent, serializing writes so two operations cannot interleave, confining a tool to one directory. Where the config format runs out, a plugin or hook takes over. Only reach for it when you have a rule that configuration genuinely cannot state.

## Roles

A role earns its existence when it needs a *different permission set* or must form an *independent judgment*. Not when it has a different name. Two roles with identical tools and no independence requirement are one role with a mood.

A useful full roster looks roughly like this. Start with two or three of them and grow.

- **Coordinator.** The primary agent. Reads, searches, reasons, delegates, synthesizes, answers. Explicitly *cannot* edit files or run mutating commands, which is the constraint that makes everything else hold. It may run an allowlist of exact read-only commands (`git status`, `git diff`, `git log`, and friends) without prompting, so it can see the world without being able to change it.
- **Implementer.** Owns source edits. Read, write, and the project's own build and test commands. Adding, removing, or upgrading a dependency requires approval; installing what the manifest already declares does not. Its checks are iterative evidence, not a verdict.
- **Verifier.** Reruns validation independently: tests, lint, type checks, build, static analysis. Edit tools denied. Write-mode formatting, snapshot updates, and anything with `--fix` or `--write` denied, because validation that repairs the thing it is validating is not validation. Reports exact commands, exit statuses, and what changed in the worktree.
- **Reviewer.** One focused axis per review, usually standards compliance or specification compliance. Read and search only. The coordinator keeps correctness and regression analysis and writes the final review. The reviewer supplies a second angle, it does not replace the first.
- **Inspector.** Drives a real browser or environment for reproduction and diagnostics. Reads the relevant source to connect observed behavior to code. Cannot edit or run project commands.
- **Researcher.** Web search and fetch, nothing else. No project access, no memory, no shell. Returns claims with URLs and dates, reports conflicts between sources, and does not draw the final conclusion. Evidence in, judgment stays with the coordinator.
- **Archivist.** The only role that touches persistent memory. No project files, no web, no general shell. It works from structured evidence the coordinator hands it, which is what keeps memory access from becoming a back door into everything else.

Four topology rules do most of the work:

- **One entry point.** The primary is how specialists get invoked. Direct invocation may still be possible in your runtime, but it is not the supported path.
- **Workers do not delegate.** Every follow-up decision returns to the coordinator. Without this you get delegation trees you cannot audit and a context bill you did not agree to.
- **The reasoner does not edit.** This is the load-bearing rule. It forces every change through a role whose entire prompt is about making that one change correctly.
- **The author does not certify.** Whoever wrote the code is not the one who declares it verified.

## Operations

**Delegate.** The coordinator writes a bounded brief: the goal, the relevant context, the boundaries, and what to return. The specialist runs, returns evidence, and the coordinator decides what it means. The brief is the interface. Vague briefs are the single most common failure, and they fail quietly, by producing plausible work on the wrong problem.

**Verify.** After implementation, an independent role reruns the project's own checks and reports exact commands and outcomes. Not "tests pass" but the command, the exit status, and the failure text. The value is entirely in the independence, so resist the temptation to skip it because the implementer already ran the tests.

**Ingest.** Explicitly hand the harness a source: a file, pasted text, a local repository, a URL. It reads, extracts, and files structured knowledge into memory with provenance. It does not keep a raw copy, and it never modifies the source. Hash the source first so re-ingesting something unchanged is a no-op instead of a duplicate. For a repository too large for one pass, map it, report the batch plan, and fan the batches out with a concurrency limit.

**Ask.** Answer a question by combining memory with live evidence, then keep the categories separate in the answer: what memory says, what the current checkout says, what external sources say, what contradicts, and what remains unknown. When memory and the working tree disagree about something mutable, the working tree wins, the conflict gets reported, and memory gets corrected.

**Lint.** Periodically health-check memory. Broken links, stale index entries, orphan pages, malformed metadata, duplicate concepts, contradictions, claims a newer source superseded, gaps worth filling. Repair the mechanical defects automatically, because they have exactly one correct fix. Report the semantic ones instead of silently rewriting them, because a contradiction is information and resolving it is a judgment call.

**Remember.** At the end of ordinary work, persist what is durable: decisions, preferences, architecture, recurring procedures, important verified facts. Exclude routine command output, transient failures, file state, speculation, and ordinary answers. Give yourself an escape hatch phrase (`do not remember this`) that suppresses persistence for the current request, and honor it.

## Memory, indexing, and logging

Two files do most of the navigation, exactly as in the wiki pattern.

**index.md** is content-oriented. Every maintained page, with a link and a one-line description, organized by category. The archivist reads it first on every operation, then drills in. At moderate scale this replaces embedding search entirely.

**log.md** is chronological and append-only. One entry per ingest, ask, lint, repair, or durable update. Keep a consistent machine-readable heading (`## 2026-08-29T19:11:36Z | ingest | <summary>`) and the log stays greppable with `grep "^## " log.md | tail -5`.

Four conventions keep the vault from rotting:

- **Label claims.** Mark each material claim `verified`, `synthesis`, `hypothesis`, `contradiction`, `unknown`, or `superseded`. The distinction between "we checked this" and "this seems likely" is the one that decays fastest without a label.
- **Tie mutable claims to provenance.** Repository identity, commit SHA, file path and line range when available, and the date it was verified. A different commit does not prove the old claim false, it flags that it might be stale, which is the useful signal.
- **Supersede instead of overwrite.** When a claim changes, record the new one and keep the old in a superseded section with both provenances. History belongs in the page, not only in Git.
- **Identify projects by sanitized remote.** Strip credentials and userinfo out of the remote URL and use that as the stable identity, so two checkouts of the same repo share one namespace. Local paths are non-authoritative aliases. Repos without a remote get an operator-assigned identifier.

Keep memory in its own Git repository, ignored by the config repo, so configuration and knowledge stay independently portable. One commit per successful operation, no commit when nothing changed, and never push automatically. On commit failure, report the dirty files and the exact Git error and stop. Do not reset, because a broken commit is recoverable and a discarded change is not.

## Permissions

Permission rules are the part everyone underestimates, so a few things worth knowing before you write yours:

- **Deny by default, allow by exception.** Start each role from nothing and add what the job needs. The reverse never converges.
- **Rules are usually order-sensitive with last-match-wins.** Broad rules first, narrow exceptions after. Getting this backwards produces configuration that looks strict and enforces nothing.
- **Allowlist exact commands, not prefixes, for read-only shell access.** `git diff --stat` is a rule. `git *` is a hole large enough to walk `git push --force` through.
- **Deny secret paths explicitly** (`*.env`, `*.pem`, `*.key`, `id_rsa`), and set the interesting ones to ask rather than allow. `*.env.example` can stay allowed.
- **Filter what you send, not only what roles can reach.** A specialist with no filesystem access still receives whatever the coordinator types into its brief. Inspect briefs for credentials, tokens, private keys, cookies, and session material, and *reject* on suspicion rather than silently redacting. Silent redaction hands a worker altered context that looks complete. Rejection makes the coordinator rewrite it with an explicit `[REDACTED_TOKEN]` placeholder, which is honest.

Now the honest part. Unless your runtime gives you real sandboxing, all of this is one OS user and one process environment. A role with shell access cannot be *proven* unable to reach any path that user can reach. Hiding a subagent from autocomplete reduces discoverability, it is not an authorization boundary. Read and edit path rules do not cover every route in, because shell, grep, glob, language servers, MCP tools, and attachments all get there differently. Pattern matching on briefs reduces accidental disclosure and cannot prove arbitrary text contains no secret.

Treat these controls as workflow shaping that makes the right path the easy path and the wrong path loud. That is genuinely valuable. It is not isolation, and a harness that claims otherwise is worse than one that admits the limit, because you will trust it with things you should not.

## Instantiating this

If you are the agent reading this document, here is the shape of the job. Do not skip step two.

1. **Learn the runtime.** Find out how *this* runtime defines agents, permissions, commands, hooks, and plugins, and which version is installed. Read its actual documentation. Configuration formats for agent runtimes change fast, and a plausible-looking config that the loader silently ignores is the worst outcome available.
2. **Interview the operator.** Ask before building. Roughly:
   - What work do you actually do most? The roster should follow the work, not a template.
   - What has an agent done that you did not want? Those become the denials.
   - Where do you want a second opinion, and where is it overhead?
   - Which commands should never run without asking?
   - What should be remembered across sessions, and what should never be written down?
   - Which model tier for which role, and what is your cost tolerance?
   - Which workflows do you retype constantly? Those become commands.
3. **Start small.** A coordinator that cannot edit, plus an implementer, plus a verifier, is already most of the value. Add roles when a real task needs a permission set you do not have.
4. **Write role prompts as constraints, not personality.** State what the role does, what it must never do, what it returns, and how it reports failure. Skip the adjectives. "Report each exact command, exit status, and resulting worktree changes" beats "be thorough and meticulous."
5. **Make it portable.** Read model and tuning choices from environment variables, and apply an override only when the variable is non-empty so an unset value falls through to inheritance instead of breaking startup. The config repo should clone onto a new machine and work without carrying machine-specific choices or a private memory vault with it.
6. **Handle absence.** If memory is missing on a new machine, the first memory operation should offer three options: initialize a new vault, connect an existing one, or continue without memory. Never overwrite or reinitialize a non-empty directory. The configuration must load fine when the vault does not exist.
7. **Test the resolved configuration, not the source.** Use the runtime's own loader and assert on what it produced: which agent is default, which are hidden, what each role's effective permissions are, that overrides apply, that a rejected brief is actually rejected. Do not snapshot prompts, do not re-test the runtime's own permission matcher, and do not assert on model prose.
8. **Restart, then check.** Most runtimes read agent, command, and plugin files only at startup, so an untested edit is an assumption. Verify the deny rules by trying the thing that should fail.

## Optional: custom tools

Configuration expresses "may this role run bash". It cannot express "may this role run exactly one Git operation, confined to one directory, serialized against every other memory write, returning the commit hash or the exact error." That is a custom tool.

Good candidates, all drawn from the same instinct of replacing a broad capability with a narrow one:

- A **commit tool** confined to one root that stages only paths inside it, rejects escaping paths, makes one commit, and never pushes. This is how the archivist gets Git without getting a shell.
- **Hashing and identity tools** so source identity is computed by code instead of asserted by a model.
- A **clone tool** that discloses the destination and network action, asks for approval, and has a matching cleanup call that runs even when analysis fails.
- A **serialization lock** so concurrent memory operations queue instead of interleaving.
- A **delegation hook** that inspects outgoing briefs and throws on suspected secrets before the subagent is ever created.

The test for whether something should be a tool is simple: if the rule you want is about *which arguments*, *in what order*, or *confined to where*, configuration will not say it and a tool will.

## Tips and tricks

- **Keep the whole harness in Git.** It is a directory of markdown and config. You get history, branching, bisecting a change that made the agent worse, and sharing for free.
- **Gitignore the memory vault from the config repo** and give it its own repository. Config is shareable, memory usually is not.
- **Tier your models by role.** Flagship judgment for review, strong mid-tier for implementation, cheap and fast for mechanical work like memory bookkeeping and running a fixed list of checks. Leave the coordinator unset so it inherits whatever session model you picked.
- **Cap concurrency on fan-out.** Make it configurable, default it low (four is a reasonable start), and report the plan before starting a large batch job.
- **Retry once, only for transport failures.** Anything else should stop and report. Retrying a real failure just produces a more confident wrong answer.
- **Report failure with structure.** What failed, the exact error, what completed, what did not, and whether persistent state changed. That last field matters more than it sounds.
- **Write commands the way you would write a runbook.** They are stored prompts, so they can be long and specific. That is the point.
- **Watch for the coordinator quietly doing the work itself.** If it starts answering things it should delegate, either the delegation is too expensive or your role prompts are too vague. Usually the latter.
- **Prune.** A role you never invoke and a memory page nothing links to are both costing you. Delete them.

## Why this works

The tedious part of working with an agent is not the thinking, it is the discipline. Remembering to ask for an independent check. Re-stating conventions every session. Noticing that the thing which wrote the code is the thing telling you it works. Keeping notes current when the work is done and you want to move on. People abandon their careful workflow within a week because holding it in your head costs more than skipping it.

Configuration does not get tired. A coordinator that cannot edit files will never edit files at 2am because the fix looked small. A verifier without write tools cannot quietly repair the thing it was checking. A researcher without project access cannot conflate what it read online with what is in your repo. These are not clever behaviors, they are removed capabilities, and removed capabilities hold under exactly the conditions where good intentions do not.

The second effect is compounding. Every constraint you discover the hard way becomes a line in a file. Every workflow you get right becomes a command. Every durable decision becomes a memory page with provenance. Six months in, the harness encodes a great deal of what you learned about working this way, and none of it depends on you remembering.

Your job is to decide the boundaries, curate what matters, and do the thinking. The agent's job is everything else, including building and maintaining the harness itself.

## Note

This document is intentionally abstract. It describes the pattern, not an implementation. The exact roles, the permission syntax, the memory schema, the plugin API, the command format: all of that depends on your runtime, your work, and your preferences. Everything above is optional and modular, so take what is useful and ignore the rest. Your memory needs might be a single markdown file, in which case skip the vault, the identity scheme, and the lint pass entirely. You might need only three roles. You might have no browser work at all and no use for an inspector. You might be on a runtime with no plugin system, in which case the enforcement layer is whatever its hooks give you and you design around the gap.

The right way to use this is to hand it to your agent, have it read your runtime's real documentation, have it interview you, and build a version that fits how you actually work. This document's only job is to communicate the pattern. Your agent can figure out the rest.
