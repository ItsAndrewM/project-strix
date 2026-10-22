import { env } from "cloudflare:test"
import { describe, expect, it } from "vitest"
import { presignGet, presignPut, urlsFor } from "../src/r2/presign.ts"

const signing = {
  ...env,
  R2_ACCESS_KEY_ID: "k",
  R2_SECRET_ACCESS_KEY: "s",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
}

const KEY = "clips/g/0/view.mp4"

describe("presignGet", () => {
  it("signs a query-string URL for the strix bucket on the S3 endpoint", async () => {
    const url = new URL(await presignGet(signing, KEY, 3600))
    expect(url.host).toBe("acct.r2.cloudflarestorage.com")
    expect(url.pathname).toBe("/strix/clips/g/0/view.mp4")
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600")
  })

  it("rejects when the R2 secrets are unset", async () => {
    await expect(presignGet(env, KEY, 3600)).rejects.toThrow(/R2_ACCESS_KEY_ID/)
  })

  it.each(["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"])("names %s when it is empty", async (name) => {
    await expect(presignGet({ ...signing, [name]: "" }, KEY, 3600)).rejects.toThrow(name)
  })
})

describe("presignPut", () => {
  it("signs a PUT distinct from the GET with the requested lifetime", async () => {
    const put = new URL(await presignPut(signing, KEY, 600))
    const get = new URL(await presignGet(signing, KEY, 600))
    expect(put.pathname).toBe("/strix/clips/g/0/view.mp4")
    expect(put.searchParams.get("X-Amz-Expires")).toBe("600")
    expect(put.searchParams.get("X-Amz-Signature")).not.toBe(get.searchParams.get("X-Amz-Signature"))
  })

  it("rejects when the R2 secrets are unset", async () => {
    await expect(presignPut(env, KEY, 3600)).rejects.toThrow(/R2_ACCESS_KEY_ID/)
  })
})

describe("urlsFor", () => {
  it("hands out unsigned r2:// URLs in the fixture environment", async () => {
    expect(env.FIXTURES).toBe("1")
    const urls = urlsFor(env)
    await expect(urls.get("originals/g.mp4")).resolves.toBe("r2://originals/g.mp4")
    await expect(urls.put(KEY)).resolves.toBe(`r2://${KEY}`)
  })

  it("presigns for an hour outside the fixture environment", async () => {
    const { FIXTURES, ...live } = signing
    expect(FIXTURES).toBe("1")
    const urls = urlsFor(live)
    const get = new URL(await urls.get(KEY))
    const put = new URL(await urls.put(KEY))
    expect(get.pathname).toBe("/strix/clips/g/0/view.mp4")
    expect(get.searchParams.get("X-Amz-Expires")).toBe("3600")
    expect(put.searchParams.get("X-Amz-Expires")).toBe("3600")
    expect(put.searchParams.get("X-Amz-Signature")).not.toBe(get.searchParams.get("X-Amz-Signature"))
  })
})
