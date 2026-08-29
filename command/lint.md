---
description: Check and repair persistent-memory structure while reporting semantic conflicts.
agent: coordinator
subtask: false
---

Run the persistent-memory lint workflow with arguments: $ARGUMENTS

Delegate to archivist. By default resolve and pass the current project's registered namespace plus its referenced shared pages; do not pass an empty scope. If the arguments contain `--all`, inspect the entire vault.

Check links, orphan pages, duplicate concepts, indexes, provenance, metadata, log shape, contradictions, superseded claims, unsupported synthesis, uncataloged pages, missing concepts, and useful knowledge gaps. Repair only unambiguous mechanical defects. Report semantic conflicts and uncertain merges without rewriting them.

Append and commit the lint result when it changes or records vault state. Report changed pages, findings, and commit hash.
