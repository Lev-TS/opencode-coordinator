---
description: Ingest a file, pasted text, local repository, or repository URL into persistent memory.
agent: coordinator
subtask: false
---

Run the explicit memory ingest workflow for: $ARGUMENTS

Accept local Markdown or text paths, pasted text with a required title, local repository paths, and repository URLs, plus an optional focus. Do not modify source inputs or store raw copies.

Resolve source identity first using `ingest_hash_file` for exact file bytes or the repository commit SHA. Ask archivist to call `memory_source_status` before analysis. Exclude secrets, ignored files, dependencies, generated output, binaries, caches, and version-control internals. Report excluded categories. Never override secret-file exclusions.

For repository URLs, use `ingest_clone_repository`, which discloses the network action and destination and requests approval before cloning. Always call `ingest_cleanup_repository` after analysis or failure. For a large repository, map it first, report why batching is needed, estimate batch count and scopes, and use separate coder tasks with the limit returned by `ingest_settings`. Retry a transient batch failure once. Do not update memory after any remaining batch failure unless the operator approves explicitly labeled partial coverage.

Combine successful evidence and send one structured update to archivist. Record provenance, a `source_identity: <kind>:<identity>` marker, coverage status, structured summary, citations, and short excerpts. The memory tool rejects unapproved partial coverage and duplicate source identities. If unchanged, report the existing record without a commit.
