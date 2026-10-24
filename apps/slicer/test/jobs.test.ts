import { describe, expect, it } from "vitest"
import { PROBE_BUDGET_MS, run, runSlice, WINDOW_BUDGET_MS } from "../src/jobs.ts"

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

  it("kills a running child when the stop signal fires and rejects as stopped", async () => {
    const controller = new AbortController()
    const startedAt = Date.now()
    const running = run(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], startedAt + 60_000, controller.signal)
    setTimeout(() => controller.abort(), 200)
    await expect(running).rejects.toThrow(`${process.execPath} stopped: the caller went away`)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  })

  it("never spawns a child once the stop signal has fired", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      run(process.execPath, ["-e", "process.stdout.write('late')"], Date.now() + 10_000, controller.signal),
    ).rejects.toThrow("stopped: the caller went away")
  })
})

describe("runSlice", () => {
  it("does nothing, not even probing, for a job whose caller has already gone", async () => {
    const controller = new AbortController()
    controller.abort()
    const emitted: unknown[] = []
    const request = { source: "https://x/y.mp4", crop: null, windows: [] }
    await runSlice(request, (progress) => emitted.push(progress), controller.signal)
    expect(emitted).toEqual([])
  })
})

describe("process budgets", () => {
  it("end before the worker gives up on the probe or on a range's progress", () => {
    expect(PROBE_BUDGET_MS).toBeLessThan(5 * 60_000)
    expect(WINDOW_BUDGET_MS).toBeLessThan(30 * 60_000)
  })

  it("give a window several times the minute an encode takes", () => {
    expect(WINDOW_BUDGET_MS).toBeGreaterThanOrEqual(5 * 60_000)
  })
})
