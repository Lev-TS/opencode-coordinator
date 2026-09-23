import type { Plugin, ToolContext } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import {
  access,
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const WORKERS = ["archivist", "coder", "inspector", "researcher", "reviewer", "verifier"] as const
const REQUIRED_VAULT_FILES = [
  "index.md",
  "log.md",
  "operating-contract.md",
  "shared/index.md",
  "projects/index.md",
  "projects/registry.md",
] as const
const CLAIM_LABELS = ["verified", "synthesis", "hypothesis", "contradiction", "unknown", "superseded"]
const DEFAULT_VAULT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "memory")

type PluginSettings = {
  vaultPath?: string
}

type Change = {
  path: string
  content: string
  mode: "replace" | "append"
}

type CommandResult = {
  stdout: string
  stderr: string
}

type SourceIdentity = {
  kind: "sha256" | "git"
  identity: string
  provenance: string
  coverage: "complete" | "partial"
  partialApproved: boolean
}

type CloneSource = {
  gitSource: string
  sanitized: string
  network: boolean
}

function result(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function commandError(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const candidate = error as Error & { stderr?: string; stdout?: string; code?: string | number }
  return [candidate.message, candidate.stderr, candidate.stdout, candidate.code && `exit: ${candidate.code}`]
    .filter(Boolean)
    .join("\n")
    .trim()
}

async function run(command: string, args: string[], cwd?: string): Promise<CommandResult> {
  const output = await execFileAsync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  })
  return { stdout: output.stdout, stderr: output.stderr }
}

function serializeArgs(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") return [value]
  if (value === null || value === undefined || typeof value !== "object") return []
  if (seen.has(value)) return []
  seen.add(value)
  if (Array.isArray(value)) return value.flatMap((item) => serializeArgs(item, seen))
  return Object.entries(value).flatMap(([key, item]) => [key, ...serializeArgs(item, seen)])
}

function placeholder(value: string) {
  return /^\[(?:redacted|removed|secret)[^\]]*\]$/i.test(value)
}

function structuredSecret(value: unknown, seen = new WeakSet<object>()): string | undefined {
  if (value === null || value === undefined || typeof value !== "object") return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:api[_-]?key|access[_-]?token|auth(?:orization)?|client[_-]?secret|password|passwd|cookie|session[_-]?(?:id|token)|secret)$/i.test(key)) {
      const candidate = typeof item === "string" ? item.trim() : ""
      if (candidate.length >= 8 && !placeholder(candidate)) return `structured secret (${key})`
    }
    const nested = structuredSecret(item, seen)
    if (nested) return nested
  }
  return undefined
}

function secretKind(value: unknown) {
  const structured = structuredSecret(value)
  if (structured) return structured
  const text = serializeArgs(value).join("\n")
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i.test(text)) return "private key"
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text)) return "AWS access key"
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(text)) return "GitHub token"
  if (/\bxox[baprs]-[A-Za-z0-9-]{16,}\b/.test(text)) return "Slack token"
  if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(text)) return "API token"
  if (/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(text)) return "session token"
  if (/\bauthorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i.test(text)) return "authorization header"
  if (/\b(?:https?|ssh):\/\/[^\s/@:]+:[^\s/@]+@/i.test(text)) return "credential-bearing URL"

  const assignment = /["']?\b(api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|cookie|session[_-]?(?:id|token)|secret)["']?\s*[:=]\s*["']?([^\s"',;}{]{8,})/gi
  for (const match of text.matchAll(assignment)) {
    if (!placeholder(match[2])) return `secret assignment (${match[1]})`
  }

  const sensitiveTerms = (process.env.OPENCODE_SENSITIVE_TERMS ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean)
  if (sensitiveTerms.some((term) => text.includes(term))) return "operator-designated sensitive text"
  return undefined
}

function assertArchivist(context: ToolContext) {
  if (context.agent !== "archivist") throw new Error("Persistent memory tools are restricted to the archivist agent")
}

async function exists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function directoryState(path: string) {
  if (!(await exists(path))) return "absent" as const
  const info = await lstat(path)
  if (!info.isDirectory()) return "not-directory" as const
  const entries = await readdir(path)
  return entries.length === 0 ? ("empty" as const) : ("non-empty" as const)
}

function within(root: string, target: string) {
  const candidate = relative(root, target)
  return candidate === "" || (!candidate.startsWith(`..${sep}`) && candidate !== ".." && !isAbsolute(candidate))
}

async function vaultPath(root: string, input: string, extension?: ".md") {
  if (!input || isAbsolute(input)) throw new Error("Memory path must be relative to the vault")
  const normalized = input.replaceAll("\\", "/")
  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Memory path contains an invalid segment")
  }
  if (segments[0] === ".git" || segments.includes("raw")) {
    throw new Error("Memory path targets a protected vault location")
  }
  if (extension && !normalized.endsWith(extension)) throw new Error(`Memory path must end in ${extension}`)

  const canonicalRoot = await realpath(root)
  let cursor = canonicalRoot
  for (const segment of segments.slice(0, -1)) {
    cursor = join(cursor, segment)
    if (!(await exists(cursor))) break
    const info = await lstat(cursor)
    if (info.isSymbolicLink()) throw new Error("Memory paths may not traverse symbolic links")
    if (!info.isDirectory()) throw new Error("Memory path parent is not a directory")
  }
  const target = resolve(canonicalRoot, normalized)
  if (!within(canonicalRoot, target)) throw new Error("Memory path escapes the vault")
  if (await exists(target)) {
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error("Memory paths may not target symbolic links")
  }
  return target
}

async function markdownFiles(root: string, scope = "") {
  const start = scope ? await vaultPath(root, scope) : await realpath(root)
  if (!(await exists(start))) return []
  const files: string[] = []
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === ".obsidian") continue
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await visit(absolute)
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute)
    }
  }
  const info = await stat(start)
  if (info.isDirectory()) await visit(start)
  else if (start.endsWith(".md")) files.push(start)
  return files.sort()
}

async function validateVault(root: string) {
  const missing: string[] = []
  for (const file of REQUIRED_VAULT_FILES) {
    const target = join(root, file)
    if (!(await exists(target))) {
      missing.push(file)
      continue
    }
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink()) missing.push(`${file} (not a regular file)`)
  }
  for (const directory of ["shared", "projects", ".git"]) {
    const target = join(root, directory)
    if (!(await exists(target))) {
      missing.push(`${directory}/`)
      continue
    }
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink()) missing.push(`${directory}/ (not a directory)`)
  }
  if (missing.length === 0) {
    const scan = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === ".git") continue
        const target = join(directory, entry.name)
        if (entry.isSymbolicLink()) {
          missing.push(`${relative(root, target)} (symbolic link)`)
          continue
        }
        if (entry.isDirectory()) await scan(target)
      }
    }
    await scan(root)
    try {
      const topLevel = (await run("git", ["rev-parse", "--show-toplevel"], root)).stdout.trim()
      if ((await realpath(topLevel)) !== (await realpath(root))) missing.push(".git/ (worktree root mismatch)")
    } catch (error) {
      missing.push(`.git/ (${oneLine(commandError(error))})`)
    }
  }
  const forbidden = (await exists(join(root, "raw"))) ? ["raw/"] : []
  return { valid: missing.length === 0 && forbidden.length === 0, missing, forbidden }
}

async function withVaultLock<T>(root: string, operation: () => Promise<T>) {
  const lock = `${root}.lock`
  const owner = join(lock, "owner.json")
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      await mkdir(lock)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EEXIST") throw error
      try {
        const data = JSON.parse(await readFile(owner, "utf8")) as { pid?: number; created?: string }
        const age = data.created ? Date.now() - Date.parse(data.created) : Number.POSITIVE_INFINITY
        let active = false
        if (data.pid) {
          try {
            process.kill(data.pid, 0)
            active = true
          } catch (processError) {
            active = (processError as NodeJS.ErrnoException).code === "EPERM"
          }
        }
        if (!active && age > 30_000) {
          await rm(lock, { recursive: true, force: true })
          continue
        }
      } catch {
        // Another process may still be writing the lock owner record.
      }
      await delay(100)
      continue
    }
    try {
      await writeFile(owner, JSON.stringify({ pid: process.pid, created: new Date().toISOString() }))
      return await operation()
    } finally {
      await rm(lock, { recursive: true, force: true })
    }
  }
  throw new Error(`Timed out waiting for memory vault lock ${lock}`)
}

async function gitStatus(root: string) {
  const { stdout } = await run("git", ["status", "--short"], root)
  return stdout.trim().split("\n").filter(Boolean)
}

async function commitPaths(root: string, paths: string[], message: string) {
  const unique = [...new Set(paths.map((path) => path.replaceAll("\\", "/")))].sort()
  if (unique.length === 0) return { changed: false as const }
  try {
    const stagedBefore = (await run("git", ["diff", "--cached", "--name-only"], root)).stdout.trim()
    if (stagedBefore) throw new Error(`Vault already has staged changes:\n${stagedBefore}`)
    await run("git", ["--literal-pathspecs", "add", "--", ...unique], root)
    const staged = (await run("git", ["diff", "--cached", "--name-only"], root)).stdout.trim()
    if (!staged) return { changed: false as const }
    const stagedFiles = staged.split("\n").filter(Boolean).sort()
    if (JSON.stringify(stagedFiles) !== JSON.stringify(unique)) {
      throw new Error(`Git staged an unexpected path set. Requested: ${unique.join(", ")}; staged: ${stagedFiles.join(", ")}`)
    }
    await run("git", ["commit", "-m", oneLine(message).slice(0, 120)], root)
    const hash = (await run("git", ["rev-parse", "HEAD"], root)).stdout.trim()
    return { changed: true as const, hash, files: stagedFiles }
  } catch (error) {
    let dirty: string[] = []
    try {
      dirty = await gitStatus(root)
    } catch {
      // Preserve the original Git failure when status is also unavailable.
    }
    throw new Error(`Memory commit failed. Dirty files: ${dirty.join(", ") || "unknown"}\n${commandError(error)}`)
  }
}

function initialFiles(now: string): Record<string, string> {
  return {
    ".gitignore": ".obsidian/workspace*\n.obsidian/cache\n.DS_Store\n",
    "operating-contract.md": `---\ntype: contract\nupdated: ${now.slice(0, 10)}\nsources: []\n---\n\n# Memory operating contract\n\nThis vault stores synthesized, durable knowledge. It excludes credentials, raw source copies, routine command output, temporary failures, and transient project state.\n\nMaterial claims use these labels: verified, synthesis, hypothesis, contradiction, unknown, and superseded. Mutable project claims include repository identity, commit SHA, verification date, and file locations when available.\n`,
    "index.md": `---\ntype: index\nupdated: ${now.slice(0, 10)}\nsources: []\n---\n\n# Memory index\n\n- [[operating-contract|Operating contract]] - Rules for durable memory.\n- [[shared/index|Shared memory]] - Cross-project knowledge.\n- [[projects/index|Projects]] - Project namespaces.\n- [[projects/registry|Project registry]] - Stable project identities and aliases.\n- [[log|Operation log]] - Auditable memory operations.\n`,
    "log.md": `---\ntype: log\nupdated: ${now.slice(0, 10)}\nsources: []\n---\n\n# Operation log\n\n## ${now} | initialize | Create memory vault\n`,
    "shared/index.md": `---\ntype: index\nupdated: ${now.slice(0, 10)}\nsources: []\n---\n\n# Shared memory\n\nCross-project preferences, concepts, procedures, entities, and analyses are cataloged here.\n`,
    "projects/index.md": `---\ntype: index\nupdated: ${now.slice(0, 10)}\nsources: []\n---\n\n# Projects\n\nRegistered project namespaces are cataloged here.\n`,
    "projects/registry.md": `---\ntype: registry\nupdated: ${now.slice(0, 10)}\nsources: []\n---\n\n# Project registry\n\nUse sanitized Git remote URLs as stable identities. Record local paths only as non-authoritative aliases. Repositories without a remote require an operator-assigned identifier.\n`,
  }
}

async function initializeVault(root: string) {
  const state = await directoryState(root)
  if (state === "non-empty" || state === "not-directory") {
    throw new Error(`Refusing to initialize ${root}: destination is ${state}`)
  }
  if (state === "absent") await mkdir(root, { recursive: false })
  const now = new Date().toISOString()
  const files = initialFiles(now)
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, { flag: "wx" })
  }
  try {
    await run("git", ["init"], root)
    await run("git", ["config", "user.name", "OpenCode Memory"], root)
    await run("git", ["config", "user.email", "memory@localhost"], root)
    const commit = await commitPaths(root, Object.keys(files), "memory: initialize vault")
    if (!commit.changed) throw new Error("Initial memory commit contained no changes")
    return { root, commit: commit.hash, files: commit.files }
  } catch (error) {
    throw new Error(`Memory initialization failed; generated files were preserved at ${root}. ${commandError(error)}`)
  }
}

async function cloneSource(source: string, base: string): Promise<CloneSource> {
  if (/^[^@\s]+@[^:\s]+:.+/.test(source)) {
    const [, host, path] = source.match(/^[^@\s]+@([^:\s]+):(.+)$/) ?? []
    return { gitSource: source, sanitized: `ssh://${host}/${path}`, network: true }
  }
  try {
    const url = new URL(source)
    if (!new Set(["https:", "ssh:", "file:"]).has(url.protocol)) throw new Error(`Unsupported Git URL scheme: ${url.protocol}`)
    if (url.password || (url.username && !["git", "ssh"].includes(url.username))) {
      throw new Error("Credential-bearing Git URLs are not allowed")
    }
    url.username = ""
    url.password = ""
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|password|signature/i.test(key)) throw new Error("Credential-bearing Git URLs are not allowed")
    }
    if (url.protocol === "file:") {
      const local = await realpath(fileURLToPath(url))
      return { gitSource: local, sanitized: local, network: false }
    }
    return { gitSource: source, sanitized: url.toString(), network: true }
  } catch (error) {
    if (error instanceof Error && (error.message.includes("Credential-bearing") || error.message.includes("Unsupported Git URL"))) throw error
    const local = await realpath(resolve(base, source))
    return { gitSource: local, sanitized: local, network: false }
  }
}

async function connectVault(root: string, source: CloneSource) {
  const state = await directoryState(root)
  if (state !== "absent" && state !== "empty") throw new Error(`Refusing to connect memory: destination is ${state}`)
  if (!source.gitSource || source.gitSource.startsWith("-")) throw new Error("Invalid memory repository source")
  const parent = dirname(root)
  const staging = join(parent, `.memory-connect-${randomUUID()}`)
  if (!source.network && source.gitSource === resolve(root)) {
    throw new Error("Memory source and destination must differ")
  }
  try {
    await run("git", ["clone", "--no-hardlinks", source.gitSource, staging], parent)
    const validation = await validateVault(staging)
    if (!validation.valid) {
      throw new Error(`Connected vault schema is invalid. Missing: ${validation.missing.join(", ") || "none"}; forbidden: ${validation.forbidden.join(", ") || "none"}`)
    }
    if (state === "empty") await rmdir(root)
    await rename(staging, root)
    const commit = (await run("git", ["rev-parse", "HEAD"], root)).stdout.trim()
    return { root, source: source.sanitized, commit }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw new Error(`Memory connection failed: ${commandError(error)}`)
  }
}

async function sourceMatches(root: string, kind: string, identity: string) {
  const canonicalRoot = await realpath(root)
  const marker = `source_identity: ${kind}:${identity}`
  const matches: string[] = []
  for (const file of await markdownFiles(canonicalRoot)) {
    if ((await readFile(file, "utf8")).includes(marker)) matches.push(relative(canonicalRoot, file).replaceAll(sep, "/"))
  }
  return { marker, matches }
}

async function updateMemory(root: string, operation: string, summary: string, changes: Change[], source?: SourceIdentity) {
  const validation = await validateVault(root)
  if (!validation.valid) throw new Error(`Memory vault is unavailable or invalid: ${result(validation)}`)
  const dirtyBefore = await gitStatus(root)
  if (dirtyBefore.length > 0) throw new Error(`Memory vault has uncommitted changes: ${dirtyBefore.join(", ")}`)

  if (operation === "ingest") {
    if (!source) throw new Error("Ingest updates require a source identity and coverage status")
    if (!source.identity.trim() || !source.provenance.trim()) throw new Error("Ingest source identity and provenance must be non-empty")
    if (source.coverage === "partial" && !source.partialApproved) {
      throw new Error("Partial ingest coverage requires explicit operator approval")
    }
    const existing = await sourceMatches(root, source.kind, source.identity)
    if (existing.matches.length > 0) {
      return { changed: false, reason: "Source identity is already ingested; no memory commit was created", existing: existing.matches }
    }
    if (!changes.some((change) => change.content.includes(existing.marker))) {
      throw new Error(`An ingest page must record ${existing.marker}`)
    }
  }

  const pending: Array<{ path: string; target: string; content: string }> = []
  const seenPaths = new Set<string>()
  for (const change of changes) {
    const normalizedPath = change.path.replaceAll("\\", "/")
    if (seenPaths.has(normalizedPath)) throw new Error(`Duplicate memory change path: ${normalizedPath}`)
    seenPaths.add(normalizedPath)
    const target = await vaultPath(root, normalizedPath, ".md")
    const previous = (await exists(target)) ? await readFile(target, "utf8") : ""
    const content = change.mode === "append" ? previous + change.content : change.content
    if (content !== previous) pending.push({ path: normalizedPath, target, content })
  }

  if (operation === "ingest" && pending.length === 0) {
    return { changed: false, reason: "Source content is unchanged; no memory commit was created" }
  }
  if (pending.length === 0 && operation !== "ask") {
    return { changed: false, reason: "No memory content changed" }
  }

  const changedPaths: string[] = []
  for (const item of pending) {
    await mkdir(dirname(item.target), { recursive: true })
    await writeFile(item.target, item.content)
    changedPaths.push(item.path)
  }
  const now = new Date().toISOString()
  await appendFile(join(root, "log.md"), `\n## ${now} | ${operation} | ${oneLine(summary)}\n`)
  changedPaths.push("log.md")
  const commit = await commitPaths(root, changedPaths, `memory: ${operation} ${summary}`)
  return { changed: commit.changed, commit: commit.changed ? commit.hash : undefined, files: commit.changed ? commit.files : [] }
}

async function lintMemory(root: string, scope: string, all: boolean, fix: boolean) {
  const validation = await validateVault(root)
  if (!validation.valid) throw new Error(`Memory vault is unavailable or invalid: ${result(validation)}`)
  const dirtyBefore = await gitStatus(root)
  if (dirtyBefore.length > 0) throw new Error(`Memory vault has uncommitted changes: ${dirtyBefore.join(", ")}`)

  if (!all && !scope) throw new Error("Scoped memory lint requires the current project namespace; use all=true for the entire vault")
  const canonicalRoot = await realpath(root)
  const selected = all ? "" : scope
  const files = await markdownFiles(canonicalRoot, selected)
  const brokenLinks: Array<{ file: string; target: string }> = []
  const malformedMetadata: string[] = []
  const semanticFlags: Array<{ file: string; labels: string[] }> = []
  for (const absolute of files) {
    const path = relative(canonicalRoot, absolute).replaceAll(sep, "/")
    const content = await readFile(absolute, "utf8")
    if (!content.startsWith("---\n") || !/^---\n[\s\S]*?\n---\n/.test(content)) malformedMetadata.push(path)
    const labels = CLAIM_LABELS.filter((label) => new RegExp(`\\b${label}\\b`, "i").test(content))
    if (labels.includes("contradiction") || labels.includes("unknown")) semanticFlags.push({ file: path, labels })
    for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      const raw = match[1].trim()
      const candidates = [resolve(canonicalRoot, raw.endsWith(".md") ? raw : `${raw}.md`), resolve(dirname(absolute), raw.endsWith(".md") ? raw : `${raw}.md`)]
      if (!(await Promise.any(candidates.map(async (candidate) => ((await exists(candidate)) ? candidate : Promise.reject()))).catch(() => undefined))) {
        brokenLinks.push({ file: path, target: raw })
      }
    }
  }

  const index = await readFile(join(canonicalRoot, "index.md"), "utf8")
  const uncataloged = files
    .map((file) => relative(canonicalRoot, file).replaceAll(sep, "/"))
    .filter((file) => file !== "index.md" && file !== "log.md" && !index.includes(file.replace(/\.md$/, "")) && !index.includes(file))

  const changedPaths: string[] = []
  if (fix) {
    const lines = index.split("\n")
    const repaired: string[] = []
    for (const line of lines) {
      const link = line.match(/\[[^\]]+\]\(([^)]+\.md)\)/)?.[1]
      if (link) {
        const target = await vaultPath(root, link, ".md").catch(() => undefined)
        if (!target || !(await exists(target))) continue
      }
      const wiki = line.match(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/)?.[1]?.trim()
      if (wiki) {
        const path = wiki.endsWith(".md") ? wiki : `${wiki}.md`
        const target = await vaultPath(root, path, ".md").catch(() => undefined)
        if (!target || !(await exists(target))) continue
      }
      repaired.push(line)
    }
    const repairedIndex = repaired.join("\n")
    if (repairedIndex !== index) {
      await writeFile(join(canonicalRoot, "index.md"), repairedIndex)
      changedPaths.push("index.md")
    }
  }

  const now = new Date().toISOString()
  const summary = `broken=${brokenLinks.length} malformed=${malformedMetadata.length} uncataloged=${uncataloged.length} semantic=${semanticFlags.length}`
  await appendFile(join(root, "log.md"), `\n## ${now} | lint | ${summary}\n`)
  changedPaths.push("log.md")
  const commit = await commitPaths(root, changedPaths, `memory: lint ${summary}`)
  return {
    scope: all ? "all" : scope || "vault root",
    brokenLinks,
    malformedMetadata,
    uncataloged,
    semanticFlags,
    repaired: changedPaths.filter((path) => path !== "log.md"),
    commit: commit.changed ? commit.hash : undefined,
  }
}

export default (async (input, options) => {
  const settings = (options ?? {}) as PluginSettings
  const root = settings.vaultPath ? resolve(settings.vaultPath) : DEFAULT_VAULT
  const sourceBase = input.directory || process.cwd()
  let queue: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(operation: () => Promise<T>) => {
    const locked = () => withVaultLock(root, operation)
    const next = queue.then(locked, locked)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  return {
    async config(config) {
      const modelOverrides = WORKERS.flatMap((worker) => {
        const value = process.env[`OPENCODE_MODEL_${worker.toUpperCase()}`]?.trim()
        return value ? ([[worker, value]] as const) : []
      })
      const variantOverrides = WORKERS.flatMap((worker) => {
        const value = process.env[`OPENCODE_VARIANT_${worker.toUpperCase()}`]?.trim()
        return value ? ([[worker, value]] as const) : []
      })
      for (const [worker, model] of modelOverrides) {
        if (!/^[^/\s]+\/[^/\s]+$/.test(model)) throw new Error(`Invalid model override for ${worker}: expected provider/model`)
      }
      const agents = (config.agent ??= {})
      for (const [worker, model] of modelOverrides) {
        agents[worker] ??= {}
        agents[worker].model = model
      }
      for (const [worker, variant] of variantOverrides) {
        agents[worker] ??= {}
        agents[worker].variant = variant
      }
    },

    async "tool.execute.before"(input, output) {
      if (input.tool !== "task") return
      const target = typeof output.args?.subagent_type === "string" ? output.args.subagent_type : output.args?.agent
      if (typeof target !== "string" || !(WORKERS as readonly string[]).includes(target)) return
      const kind = secretKind(output.args)
      if (kind) {
        throw new Error(`Delegation blocked: the worker brief appears to contain ${kind}. Rewrite it with an explicit redaction placeholder.`)
      }
    },

    tool: {
      memory_status: tool({
        description: "Report whether the persistent memory vault is absent, empty, valid, or incompatible.",
        args: {},
        async execute(_args, context) {
          assertArchivist(context)
          return exclusive(async () => {
            const state = await directoryState(root)
            const validation = state === "non-empty" ? await validateVault(root) : undefined
            return result({ root, state, validation })
          })
        },
      }),

      memory_initialize: tool({
        description: "Initialize a conforming memory vault and its independent local Git repository.",
        args: {},
        async execute(_args, context) {
          assertArchivist(context)
          await context.ask({
            permission: "memory_initialize",
            patterns: [root],
            always: [],
            metadata: { destination: root },
          })
          return exclusive(async () => result(await initializeVault(root)))
        },
      }),

      memory_connect: tool({
        description: "Clone and validate an existing local or remote Git memory vault after approval.",
        args: {
          source: tool.schema.string().min(1).describe("Local Git repository path or Git URL"),
        },
        async execute(args, context) {
          assertArchivist(context)
          const source = await cloneSource(args.source, sourceBase)
          await context.ask({
            permission: "memory_connect",
            patterns: [source.sanitized, root],
            always: [],
            metadata: { source: source.sanitized, destination: root, network: source.network },
          })
          return exclusive(async () => result(await connectVault(root, source)))
        },
      }),

      memory_read: tool({
        description: "Read one Markdown page from the memory vault.",
        args: {
          path: tool.schema.string().min(1).describe("Vault-relative Markdown path"),
        },
        async execute(args, context) {
          assertArchivist(context)
          return exclusive(async () => {
            const validation = await validateVault(root)
            if (!validation.valid) throw new Error(`Memory vault is unavailable or invalid: ${result(validation)}`)
            const target = await vaultPath(root, args.path, ".md")
            return await readFile(target, "utf8")
          })
        },
      }),

      memory_search: tool({
        description: "Search Markdown pages in the memory vault, consulting index.md first.",
        args: {
          query: tool.schema.string().min(1),
          scope: tool.schema.string().default("").describe("Optional vault-relative directory or Markdown file"),
          limit: tool.schema.number().int().min(1).max(100).default(25),
        },
        async execute(args, context) {
          assertArchivist(context)
          return exclusive(async () => {
            const validation = await validateVault(root)
            if (!validation.valid) throw new Error(`Memory vault is unavailable or invalid: ${result(validation)}`)
            const files = await markdownFiles(root, args.scope)
            const ordered = [join(root, "index.md"), ...files.filter((file) => file !== join(root, "index.md"))]
            const matches: Array<{ path: string; line: number; excerpt: string }> = []
            const needle = args.query.toLocaleLowerCase()
            for (const file of ordered) {
              const lines = (await readFile(file, "utf8")).split("\n")
              for (let index = 0; index < lines.length; index += 1) {
                if (lines[index].toLocaleLowerCase().includes(needle)) {
                  matches.push({ path: relative(root, file).replaceAll(sep, "/"), line: index + 1, excerpt: lines[index].trim() })
                  if (matches.length >= args.limit) return result(matches)
                }
              }
            }
            return result(matches)
          })
        },
      }),

      memory_hash: tool({
        description: "Compute a SHA-256 identity for exact UTF-8 text without storing it.",
        args: {
          text: tool.schema.string(),
        },
        async execute(args, context) {
          assertArchivist(context)
          return result({ algorithm: "sha256", hash: createHash("sha256").update(args.text, "utf8").digest("hex") })
        },
      }),

      memory_source_status: tool({
        description: "Check whether a SHA-256 or Git source identity is already present before ingest analysis.",
        args: {
          kind: tool.schema.enum(["sha256", "git"]),
          identity: tool.schema.string().min(1),
        },
        async execute(args, context) {
          assertArchivist(context)
          return exclusive(async () => {
            const validation = await validateVault(root)
            if (!validation.valid) throw new Error(`Memory vault is unavailable or invalid: ${result(validation)}`)
            const matches = await sourceMatches(root, args.kind, args.identity)
            return result({ present: matches.matches.length > 0, pages: matches.matches })
          })
        },
      }),

      memory_update: tool({
        description: "Apply a serialized memory operation and create its single local Git commit.",
        args: {
          operation: tool.schema.enum(["ingest", "ask", "stale-memory", "durable-update"]),
          summary: tool.schema.string().min(1).max(500),
          changes: tool.schema
            .array(
              tool.schema.object({
                path: tool.schema.string().min(1),
                content: tool.schema.string(),
                mode: tool.schema.enum(["replace", "append"]).default("replace"),
              }),
            )
            .default([]),
          source: tool.schema
            .object({
              kind: tool.schema.enum(["sha256", "git"]),
              identity: tool.schema.string().min(1),
              provenance: tool.schema.string().min(1),
              coverage: tool.schema.enum(["complete", "partial"]),
            })
            .optional(),
        },
        async execute(args, context) {
          assertArchivist(context)
          let source = args.source ? { ...args.source, partialApproved: false } : undefined
          if (args.operation === "ingest" && source?.coverage === "partial") {
            await context.ask({
              permission: "memory_partial_ingest",
              patterns: [`${source.kind}:${source.identity}`],
              always: [],
              metadata: { identity: source.identity, provenance: source.provenance, coverage: "partial" },
            })
            source = { ...source, partialApproved: true }
          }
          return exclusive(async () => result(await updateMemory(root, args.operation, args.summary, args.changes, source)))
        },
      }),

      memory_lint: tool({
        description: "Lint memory, repair safe index defects, report semantic flags, log the pass, and commit it.",
        args: {
          scope: tool.schema.string().default(""),
          all: tool.schema.boolean().default(false),
          fix: tool.schema.boolean().default(true),
        },
        async execute(args, context) {
          assertArchivist(context)
          return exclusive(async () => result(await lintMemory(root, args.scope, args.all, args.fix)))
        },
      }),

      memory_commit: tool({
        description: "Commit specified existing vault paths locally without pushing.",
        args: {
          paths: tool.schema.array(tool.schema.string().min(1)).min(1),
          message: tool.schema.string().min(1).max(120),
        },
        async execute(args, context) {
          assertArchivist(context)
          return exclusive(async () => {
            const relativePaths: string[] = []
            for (const path of args.paths) {
              await vaultPath(root, path)
              relativePaths.push(path)
            }
            return result(await commitPaths(root, relativePaths, args.message))
          })
        },
      }),

      ingest_settings: tool({
        description: "Return the enforced repository-ingest concurrency setting.",
        args: {},
        async execute(_args, context) {
          if (context.agent !== "coordinator") throw new Error("Ingest orchestration tools are restricted to the coordinator")
          const configured = process.env.OPENCODE_INGEST_CONCURRENCY?.trim()
          const concurrency = configured ? Number(configured) : 4
          if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
            throw new Error("OPENCODE_INGEST_CONCURRENCY must be an integer from 1 to 16")
          }
          return result({ concurrency })
        },
      }),

      ingest_hash_file: tool({
        description: "Compute SHA-256 over the exact bytes of one file inside the current project.",
        args: {
          path: tool.schema.string().min(1),
        },
        async execute(args, context) {
          if (context.agent !== "coordinator") throw new Error("Ingest orchestration tools are restricted to the coordinator")
          const worktree = await realpath(context.worktree)
          const target = await realpath(resolve(worktree, args.path))
          if (!within(worktree, target)) throw new Error("Ingest source path escapes the current project")
          const info = await lstat(target)
          if (!info.isFile() || info.isSymbolicLink()) throw new Error("Ingest source must be a regular file")
          const content = await readFile(target)
          return result({ algorithm: "sha256", hash: createHash("sha256").update(content).digest("hex"), bytes: content.byteLength })
        },
      }),

      ingest_clone_repository: tool({
        description: "Clone an approved remote repository into a disclosed temporary directory for ingest.",
        args: {
          source: tool.schema.string().min(1),
        },
        async execute(args, context) {
          if (context.agent !== "coordinator") throw new Error("Ingest orchestration tools are restricted to the coordinator")
          const source = await cloneSource(args.source, context.directory)
          if (!source.network) throw new Error("Use the existing local repository path directly; cloning is only for remote ingest sources")
          const parent = join(homedir(), ".cache", "opencode", "ingest")
          const destination = join(parent, randomUUID())
          const marker = `${destination}.opencode-ingest-temp`
          await context.ask({
            permission: "ingest_clone_repository",
            patterns: [source.sanitized, destination],
            always: [],
            metadata: { source: source.sanitized, destination, network: true },
          })
          await mkdir(parent, { recursive: true })
          try {
            await run("git", ["clone", "--no-hardlinks", source.gitSource, destination], parent)
            const commit = (await run("git", ["rev-parse", "HEAD"], destination)).stdout.trim()
            await writeFile(marker, `${source.sanitized}\n`)
            return result({ source: source.sanitized, destination, commit })
          } catch (error) {
            await rm(destination, { recursive: true, force: true })
            await rm(marker, { force: true })
            throw new Error(`Repository ingest clone failed: ${commandError(error)}`)
          }
        },
      }),

      ingest_cleanup_repository: tool({
        description: "Remove a temporary repository created by ingest_clone_repository.",
        args: {
          destination: tool.schema.string().min(1),
        },
        async execute(args, context) {
          if (context.agent !== "coordinator") throw new Error("Ingest orchestration tools are restricted to the coordinator")
          const parent = resolve(homedir(), ".cache", "opencode", "ingest")
          const destination = resolve(args.destination)
          const marker = `${destination}.opencode-ingest-temp`
          if (!within(parent, destination) || dirname(destination) !== parent) throw new Error("Ingest cleanup path is outside the managed cache")
          if (!(await exists(marker))) throw new Error("Ingest cleanup marker is missing")
          await rm(destination, { recursive: true, force: true })
          await rm(marker, { force: true })
          return result({ removed: destination })
        },
      }),
    },
  }
}) satisfies Plugin
