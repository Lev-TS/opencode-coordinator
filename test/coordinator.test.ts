import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import type { ToolContext, ToolResult } from "@opencode-ai/plugin"
import coordinatorPlugin from "../plugin/coordinator.ts"

type ToolExecutor = {
  execute(args: unknown, context: ToolContext): Promise<ToolResult>
}

function context(agent = "archivist", approvals: Array<Record<string, unknown>> = []): ToolContext {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent,
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: new AbortController().signal,
    metadata() {},
    async ask(input) {
      approvals.push(input)
    },
  }
}

async function harness(vaultPath: string) {
  const hooks = await coordinatorPlugin({} as never, { vaultPath })
  const call = async (name: string, args: unknown = {}, toolContext = context()) => {
    const definitions = hooks.tool as Record<string, ToolExecutor> | undefined
    const definition = definitions?.[name]
    assert.ok(definition, `Missing tool ${name}`)
    return definition.execute(args, toolContext)
  }
  return { hooks, call }
}

function parsed(value: ToolResult) {
  if (typeof value !== "string") throw new Error("Expected a string tool result")
  return JSON.parse(value)
}

async function temporaryVault() {
  const parent = await mkdtemp(join(tmpdir(), "opencode-memory-test-"))
  return { parent, vault: join(parent, "memory") }
}

test("resolved OpenCode configuration discovers the coordinator system", () => {
  const config = JSON.parse(execFileSync("opencode", ["debug", "config"], { encoding: "utf8" }))
  assert.equal(config.default_agent, "coordinator")
  assert.equal(config.subagent_depth, 1)
  assert.equal(config.agent.coordinator.mode, "primary")
  for (const worker of ["archivist", "coder", "inspector", "researcher", "reviewer", "verifier"]) {
    assert.equal(config.agent[worker].hidden, true)
    assert.equal(config.agent[worker].mode, "subagent")
  }
  assert.equal(config.command.ingest.agent, "coordinator")
  assert.equal(config.command.ask.agent, "coordinator")
  assert.equal(config.command.lint.agent, "coordinator")
  assert.match(config.plugin[0], /plugin\/coordinator\.ts$/)
})

test("resolved permissions keep role boundaries", () => {
  const inspect = (agent: string) => JSON.parse(execFileSync("opencode", ["debug", "agent", agent], { encoding: "utf8" }))
  const coordinator = inspect("coordinator")
  const archivist = inspect("archivist")
  const inspector = inspect("inspector")
  const researcher = inspect("researcher")

  assert.equal(coordinator.tools.apply_patch, false)
  assert.equal(coordinator.tools.task, true)
  assert.equal(coordinator.tools.memory_read, false)
  assert.equal(coordinator.tools.ingest_hash_file, true)
  assert.equal(archivist.tools.bash, false)
  assert.equal(archivist.tools.read, false)
  assert.equal(archivist.tools.memory_read, true)
  assert.equal(archivist.tools.memory_initialize, true)
  assert.equal(inspector.tools.bash, false)
  assert.equal(researcher.tools.read, false)
  assert.equal(researcher.tools.webfetch, true)

  for (const worker of ["archivist", "coder", "inspector", "researcher", "reviewer", "verifier"]) {
    const resolved = inspect(worker)
    assert.ok(resolved.permission.some((rule: { permission: string; action: string }) => rule.permission === "task" && rule.action === "deny"))
  }
  assert.ok(inspect("verifier").permission.some((rule: { permission: string; pattern: string; action: string }) => rule.permission === "bash" && rule.pattern === "*--fix*" && rule.action === "deny"))
  assert.ok(inspect("coder").permission.some((rule: { permission: string; pattern: string; action: string }) => rule.permission === "bash" && rule.pattern === "npm i *" && rule.action === "ask"))
  assert.ok(archivist.permission.some((rule: { permission: string; action: string }) => rule.permission === "memory_initialize" && rule.action === "ask"))
  assert.ok(coordinator.permission.some((rule: { permission: string; action: string }) => rule.permission === "ingest_clone_repository" && rule.action === "ask"))
})

test("model and variant overrides apply only when non-empty", async () => {
  const previousModel = process.env.OPENCODE_MODEL_CODER
  const previousVariant = process.env.OPENCODE_VARIANT_CODER
  try {
    delete process.env.OPENCODE_MODEL_CODER
    delete process.env.OPENCODE_VARIANT_CODER
    const without = await coordinatorPlugin({} as never, {})
    const configWithout = { agent: { coder: {} as { model?: string; variant?: string } } }
    await without.config?.(configWithout as never)
    assert.equal(configWithout.agent.coder.model, undefined)
    assert.equal(configWithout.agent.coder.variant, undefined)

    process.env.OPENCODE_MODEL_CODER = "anthropic/claude-sonnet-4-6"
    process.env.OPENCODE_VARIANT_CODER = "high"
    const withOverride = await coordinatorPlugin({} as never, {})
    const configWith = { agent: { coder: {} as { model?: string; variant?: string } } }
    await withOverride.config?.(configWith as never)
    assert.equal(configWith.agent.coder.model, "anthropic/claude-sonnet-4-6")
    assert.equal(configWith.agent.coder.variant, "high")
  } finally {
    if (previousModel === undefined) delete process.env.OPENCODE_MODEL_CODER
    else process.env.OPENCODE_MODEL_CODER = previousModel
    if (previousVariant === undefined) delete process.env.OPENCODE_VARIANT_CODER
    else process.env.OPENCODE_VARIANT_CODER = previousVariant
  }
})

test("resolved loader applies present worker model and variant overrides", () => {
  const resolved = JSON.parse(
    execFileSync("opencode", ["debug", "agent", "coder"], {
      encoding: "utf8",
      env: {
        ...process.env,
        OPENCODE_MODEL_CODER: "anthropic/claude-sonnet-4-6",
        OPENCODE_VARIANT_CODER: "high",
      },
    }),
  )
  assert.deepEqual(resolved.model, { providerID: "anthropic", modelID: "claude-sonnet-4-6" })
  assert.equal(resolved.variant, "high")
})

test("secret-bearing task briefs are rejected and redacted briefs pass", async () => {
  const { hooks } = await harness("/unused")
  await assert.rejects(
    hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "session", callID: "call" },
      { args: { subagent_type: "coder", prompt: "Use api_key=abcdefghijklmnop in the request" } },
    ),
    /Delegation blocked.*secret assignment/,
  )
  await assert.doesNotReject(
    hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "session", callID: "call" },
      { args: { subagent_type: "coder", prompt: "Use api_key=[REDACTED_TOKEN] in the request" } },
    ),
  )
  await assert.rejects(
    hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "session", callID: "call" },
      { args: { subagent_type: "reviewer", metadata: { authorization: "Bearer abcdefghijklmnop" } } },
    ),
    /structured secret/,
  )
  await assert.doesNotReject(
    hooks["tool.execute.before"]?.(
      { tool: "task", sessionID: "session", callID: "call" },
      { args: { subagent_type: "explore", prompt: "api_key=abcdefghijklmnop" } },
    ),
  )
})

test("initialization creates a valid independent vault and initial commit", async (t) => {
  const { parent, vault } = await temporaryVault()
  t.after(() => rm(parent, { recursive: true, force: true }))
  const approvals: Array<Record<string, unknown>> = []
  const { call } = await harness(vault)

  const initialized = parsed(await call("memory_initialize", {}, context("archivist", approvals)))
  assert.equal(initialized.root, vault)
  assert.match(initialized.commit, /^[0-9a-f]{40,64}$/)
  assert.equal(approvals.length, 1)
  assert.equal(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: vault, encoding: "utf8" }).trim(), "1")
  assert.equal(execFileSync("git", ["remote"], { cwd: vault, encoding: "utf8" }).trim(), "")
  assert.match(await readFile(join(vault, "index.md"), "utf8"), /\[\[operating-contract/)
  await assert.rejects(call("memory_initialize"), /destination is non-empty/)
})

test("initialization refuses an existing non-empty directory", async (t) => {
  const { parent, vault } = await temporaryVault()
  t.after(() => rm(parent, { recursive: true, force: true }))
  await mkdir(vault)
  await writeFile(join(vault, "keep.txt"), "do not overwrite")
  const { call } = await harness(vault)
  await assert.rejects(call("memory_initialize"), /destination is non-empty/)
  assert.equal(await readFile(join(vault, "keep.txt"), "utf8"), "do not overwrite")
})

test("memory tools enforce archivist identity and path confinement", async (t) => {
  const { parent, vault } = await temporaryVault()
  t.after(() => rm(parent, { recursive: true, force: true }))
  const { call } = await harness(vault)
  await call("memory_initialize")
  await assert.rejects(call("memory_status", {}, context("coordinator")), /restricted to the archivist/)
  await assert.rejects(call("memory_read", { path: "../outside.md" }), /invalid segment/)
  await assert.rejects(call("memory_update", {
    operation: "durable-update",
    summary: "bad path",
    changes: [{ path: "raw/source.md", content: "secret", mode: "replace" }],
  }), /protected vault location/)
})

test("ingest tools hash exact bytes and validate concurrency", async (t) => {
  const { parent, vault } = await temporaryVault()
  t.after(() => rm(parent, { recursive: true, force: true }))
  const source = join(parent, "source.bin")
  await writeFile(source, Buffer.from([0, 1, 2, 255]))
  const { call } = await harness(vault)
  const coordinatorContext = { ...context("coordinator"), directory: parent, worktree: parent }
  const hash = parsed(await call("ingest_hash_file", { path: "source.bin" }, coordinatorContext))
  assert.equal(hash.hash, "3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56")
  assert.equal(hash.bytes, 4)
  assert.equal(parsed(await call("ingest_settings", {}, coordinatorContext)).concurrency, 4)
  await assert.rejects(call("ingest_hash_file", { path: "source.bin" }, context("coder")), /restricted to the coordinator/)
})

test("updates serialize into distinct commits and unchanged ingest creates none", async (t) => {
  const { parent, vault } = await temporaryVault()
  t.after(() => rm(parent, { recursive: true, force: true }))
  const { call } = await harness(vault)
  await call("memory_initialize")
  const secondHarness = await harness(vault)

  const [first, second] = await Promise.all([
    secondHarness.call("memory_update", {
      operation: "durable-update",
      summary: "record preference",
      changes: [{ path: "shared/preferences.md", content: "---\ntype: preferences\nupdated: 2026-08-29\nsources: []\n---\n\n# Preferences\n", mode: "replace" }],
    }),
    call("memory_update", {
      operation: "durable-update",
      summary: "record procedure",
      changes: [{ path: "shared/procedures.md", content: "---\ntype: procedure\nupdated: 2026-08-29\nsources: []\n---\n\n# Procedures\n", mode: "replace" }],
    }),
  ])
  assert.notEqual(parsed(first).commit, parsed(second).commit)
  const sourcePage = "---\ntype: source\nupdated: 2026-08-29\nsources: []\n---\n\n# Test source\n\nsource_identity: sha256:abc123\n"
  await call("memory_update", {
    operation: "ingest",
    summary: "new source",
    source: { kind: "sha256", identity: "abc123", provenance: "test fixture", coverage: "complete" },
    changes: [{ path: "projects/example/sources/test.md", content: sourcePage, mode: "replace" }],
  })
  const countBefore = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: vault, encoding: "utf8" }).trim()
  assert.deepEqual(parsed(await call("memory_source_status", { kind: "sha256", identity: "abc123" })).pages, ["projects/example/sources/test.md"])
  const unchanged = parsed(await call("memory_update", {
    operation: "ingest",
    summary: "same source",
    source: { kind: "sha256", identity: "abc123", provenance: "test fixture", coverage: "complete" },
    changes: [{ path: "projects/example/sources/test.md", content: sourcePage, mode: "replace" }],
  }))
  assert.equal(unchanged.changed, false)
  assert.equal(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: vault, encoding: "utf8" }).trim(), countBefore)
  const deniedApproval = { ...context("archivist"), async ask() { throw new Error("operator denied partial coverage") } }
  await assert.rejects(call("memory_update", {
    operation: "ingest",
    summary: "partial source",
    source: { kind: "git", identity: "deadbeef", provenance: "test fixture", coverage: "partial" },
    changes: [{ path: "projects/example/sources/partial.md", content: "source_identity: git:deadbeef\n", mode: "replace" }],
  }, deniedApproval), /operator denied partial coverage/)
})

test("connection validates local vaults and rejects credential-bearing URLs", async (t) => {
  const sourceFixture = await temporaryVault()
  const destinationFixture = await temporaryVault()
  t.after(() => rm(sourceFixture.parent, { recursive: true, force: true }))
  t.after(() => rm(destinationFixture.parent, { recursive: true, force: true }))
  const source = await harness(sourceFixture.vault)
  await source.call("memory_initialize")

  const destination = await harness(destinationFixture.vault)
  const connected = parsed(await destination.call("memory_connect", { source: sourceFixture.vault }))
  assert.equal(connected.root, destinationFixture.vault)
  assert.match(connected.commit, /^[0-9a-f]{40,64}$/)
  await assert.rejects(destination.call("memory_connect", { source: "https://token:secret@example.com/vault.git" }), /Credential-bearing/)
})

test("connection accepts an empty destination and rejects symlinked vault schemas", async (t) => {
  const sourceFixture = await temporaryVault()
  const destinationFixture = await temporaryVault()
  const unsafeFixture = await temporaryVault()
  t.after(() => rm(sourceFixture.parent, { recursive: true, force: true }))
  t.after(() => rm(destinationFixture.parent, { recursive: true, force: true }))
  t.after(() => rm(unsafeFixture.parent, { recursive: true, force: true }))
  const source = await harness(sourceFixture.vault)
  await source.call("memory_initialize")
  await mkdir(destinationFixture.vault)
  const destination = await harness(destinationFixture.vault)
  assert.equal(parsed(await destination.call("memory_connect", { source: sourceFixture.vault })).root, destinationFixture.vault)

  execFileSync("git", ["clone", "--no-hardlinks", sourceFixture.vault, unsafeFixture.vault], { stdio: "ignore" })
  await rm(join(unsafeFixture.vault, "index.md"))
  await symlink("/etc/passwd", join(unsafeFixture.vault, "index.md"))
  execFileSync("git", ["add", "index.md"], { cwd: unsafeFixture.vault })
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "unsafe schema"], { cwd: unsafeFixture.vault })
  const blockedFixture = await temporaryVault()
  t.after(() => rm(blockedFixture.parent, { recursive: true, force: true }))
  const blocked = await harness(blockedFixture.vault)
  await assert.rejects(blocked.call("memory_connect", { source: unsafeFixture.vault }), /schema is invalid/)
})

test("lint records semantic flags, removes stale index links, and commits", async (t) => {
  const { parent, vault } = await temporaryVault()
  t.after(() => rm(parent, { recursive: true, force: true }))
  const { call } = await harness(vault)
  await call("memory_initialize")
  const index = await readFile(join(vault, "index.md"), "utf8")
  await call("memory_update", {
    operation: "durable-update",
    summary: "add lint fixture",
    changes: [
      { path: "index.md", content: `${index}\n- [Missing](missing.md)\n`, mode: "replace" },
      { path: "shared/conflict.md", content: "---\ntype: analysis\nupdated: 2026-08-29\nsources: []\n---\n\n# Conflict\n\ncontradiction: two claims disagree.\n", mode: "replace" },
    ],
  })
  const lint = parsed(await call("memory_lint", { all: true, scope: "", fix: true }))
  assert.ok(lint.semanticFlags.some((entry: { file: string }) => entry.file === "shared/conflict.md"))
  assert.deepEqual(lint.repaired, ["index.md"])
  assert.doesNotMatch(await readFile(join(vault, "index.md"), "utf8"), /missing\.md/)
  assert.match(lint.commit, /^[0-9a-f]{40,64}$/)
})

test("commit failure preserves dirty files and reports Git evidence", async (t) => {
  const { parent, vault } = await temporaryVault()
  t.after(() => rm(parent, { recursive: true, force: true }))
  const { call } = await harness(vault)
  await call("memory_initialize")
  const hook = join(vault, ".git", "hooks", "pre-commit")
  await writeFile(hook, "#!/bin/sh\necho blocked-by-test >&2\nexit 1\n", { mode: 0o755 })

  await assert.rejects(
    call("memory_update", {
      operation: "durable-update",
      summary: "trigger failure",
      changes: [{ path: "shared/failure.md", content: "---\ntype: analysis\nupdated: 2026-08-29\nsources: []\n---\n\n# Failure\n", mode: "replace" }],
    }),
    /Memory commit failed[\s\S]*shared\/failure\.md[\s\S]*blocked-by-test/,
  )
  assert.match(await readFile(join(vault, "shared/failure.md"), "utf8"), /# Failure/)
  assert.match(execFileSync("git", ["status", "--short"], { cwd: vault, encoding: "utf8" }), /shared\/failure\.md/)
})

test("memory commit treats Git pathspec syntax literally", async (t) => {
  const { parent, vault } = await temporaryVault()
  t.after(() => rm(parent, { recursive: true, force: true }))
  const { call } = await harness(vault)
  await call("memory_initialize")
  await writeFile(join(vault, "shared", "unrelated.md"), "untracked\n")
  await assert.rejects(call("memory_commit", { paths: [":(glob)**"], message: "must not stage wildcard" }), /Memory commit failed/)
  assert.equal(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: vault, encoding: "utf8" }).trim(), "")
  assert.match(execFileSync("git", ["status", "--short"], { cwd: vault, encoding: "utf8" }), /shared\/unrelated\.md/)
})
