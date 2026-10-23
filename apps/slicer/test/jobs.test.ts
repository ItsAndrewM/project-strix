import { describe, expect, it } from "vitest"
import { PROBE_BUDGET_MS, run, SLICE_BUDGET_MS } from "../src/jobs.ts"

const node = (script: string, deadline: number) => run(process.execPath, ["-e", script], deadline)

describe("run", () => {
  it("resolves with the child's stdout when it exits cleanly in time", async () => {
    const output = await node("process.stdout.write('hello')", Date.now() + 10_000)
    expect(output.toString("utf8")).toBe("hello")
  })

  it("rejects with the tail of stderr when the child exits non-zero", async () => {
    await expect(node("console.error('boom'); process.exit(3)", Date.now() + 10_000)).rejects.toThrow(
      `${process.execPath} exited 3: boom`,
    )
  })

  it("kills a child still running at the deadline and rejects", async () => {
    const startedAt = Date.now()
    await expect(node("setTimeout(() => {}, 30_000)", startedAt + 200)).rejects.toThrow(
      "killed after 0 s: the job's time budget is spent",
    )
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  it("never spawns a child once the deadline has passed", async () => {
    await expect(node("process.stdout.write('late')", Date.now() - 1)).rejects.toThrow(
      "killed after 0 s: the job's time budget is spent",
    )
  })
})

describe("job budgets", () => {
  it("end before the worker's probe and range alarms fire", () => {
    expect(PROBE_BUDGET_MS).toBeLessThan(5 * 60_000)
    expect(SLICE_BUDGET_MS).toBeLessThan(30 * 60_000)
  })
})
