import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { pathToFileURL } from "node:url"

test("deleted Herdr child sessions no longer suppress root activity reports", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "herdr-agent-state-test-"))
  const socketPath = join(directory, "herdr.sock")
  const messages: Array<Record<string, unknown>> = []
  const server = createServer((socket) => {
    socket.on("data", (data) => {
      messages.push(JSON.parse(data.toString()))
      socket.write("{}\n")
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, resolve)
  })

  const previousEnvironment = {
    HERDR_ENV: process.env.HERDR_ENV,
    HERDR_PANE_ID: process.env.HERDR_PANE_ID,
    HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH,
  }
  process.env.HERDR_ENV = "1"
  process.env.HERDR_PANE_ID = "pane-test"
  process.env.HERDR_SOCKET_PATH = socketPath

  t.after(async () => {
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  })

  const pluginURL = pathToFileURL(join(process.cwd(), "plugins/herdr-agent-state.js"))
  pluginURL.searchParams.set("test", String(Date.now()))
  const { HerdrAgentStatePlugin } = await import(pluginURL.href)
  const hooks = await HerdrAgentStatePlugin()

  await hooks.event({
    event: {
      type: "session.created",
      properties: { sessionID: "child", info: { id: "child", parentID: "root" } },
    },
  })
  await hooks.event({
    event: {
      type: "session.deleted",
      properties: { sessionID: "child", info: { id: "child", parentID: "root" } },
    },
  })
  await hooks["chat.message"]({ sessionID: "child" })

  assert.equal(messages.length, 1)
  assert.equal(messages[0].method, "pane.report_agent")
  assert.deepEqual(messages[0].params, {
    pane_id: "pane-test",
    source: "herdr:opencode",
    agent: "opencode",
    seq: (messages[0].params as { seq: number }).seq,
    state: "working",
    agent_session_id: "child",
  })
})
