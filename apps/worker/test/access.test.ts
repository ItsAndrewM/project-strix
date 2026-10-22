import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  type JWTPayload,
  type JWTVerifyGetKey,
  SignJWT,
  UnsecuredJWT,
} from "jose"
import { beforeAll, describe, expect, it } from "vitest"
import { type AccessSettings, callerOf } from "../src/access.ts"

const TEAM = "https://strix-test.cloudflareaccess.com"
const AUD = "strix-test-aud"
const SETTINGS: AccessSettings = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }

let keys: JWTVerifyGetKey
let privateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true })
  privateKey = pair.privateKey
  keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" }] })
})

interface TokenOptions {
  readonly issuer?: string
  readonly audience?: string | string[]
  readonly expiresIn?: string
  readonly keyId?: string
}

const sign = (claims: JWTPayload, options: TokenOptions = {}) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: options.keyId ?? "k1" })
    .setIssuer(options.issuer ?? TEAM)
    .setAudience(options.audience ?? AUD)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "1h")
    .sign(privateKey)

const carrying = (token: string) =>
  new Request("https://strix.example.test/api/me", { headers: { "cf-access-jwt-assertion": token } })

const viaJwt = async (token: string, settings: AccessSettings = SETTINGS) =>
  callerOf(carrying(token), undefined, settings, () => keys)

const stubAccess = (identity: CloudflareAccessIdentity | undefined): CloudflareAccessContext => ({
  aud: "strix-local",
  getIdentity: async () => identity,
})

describe("a caller vouched for by an Access JWT", () => {
  it("is a user, with the email lowercased", async () => {
    expect(await viaJwt(await sign({ email: "Andrew@Example.TEST", type: "app" }))).toEqual({
      kind: "user",
      email: "andrew@example.test",
    })
  })

  it("is a service, identified by its Client ID, for a service token", async () => {
    expect(await viaJwt(await sign({ common_name: "strix-admin.access", sub: "" }))).toEqual({
      kind: "service",
      clientId: "strix-admin.access",
    })
  })

  it.each([
    ["a list, as in a user's token", [AUD]],
    ["a string, as in a service token's", AUD],
  ])("accepts the AUD tag as %s", async (_label, audience) => {
    expect(await viaJwt(await sign({ email: "emily@example.test" }, { audience }))).toEqual({
      kind: "user",
      email: "emily@example.test",
    })
  })

  it.each([
    ["another app's audience", { audience: "another-app" }, "wrong-audience"],
    ["another team's issuer", { issuer: "https://evil.cloudflareaccess.com" }, "wrong-issuer"],
    ["an expired token", { expiresIn: "-1m" }, "expired"],
    ["a key that isn't in the team's key set", { keyId: "k2" }, "unknown-key"],
  ])("is unauthenticated for %s, and says which check refused it", async (_label, options, reason) => {
    expect(await viaJwt(await sign({ email: "andrew@example.test" }, options))).toEqual({
      kind: "unauthenticated",
      reason,
    })
  })

  it("is unauthenticated for an unsigned token", async () => {
    const unsigned = new UnsecuredJWT({ email: "andrew@example.test" }).setIssuer(TEAM).setAudience(AUD).encode()
    expect(await viaJwt(unsigned)).toEqual({ kind: "unauthenticated", reason: "wrong-algorithm" })
  })

  it("is unauthenticated for a token signed with a shared secret instead of the team's key", async () => {
    const hs256 = await new SignJWT({ email: "andrew@example.test" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a secret anyone could pick"))
    expect(await viaJwt(hs256)).toEqual({ kind: "unauthenticated", reason: "wrong-algorithm" })
  })

  it("is unauthenticated for a token whose payload was swapped after signing", async () => {
    const [header, , signature] = (await sign({ email: "emily@example.test" })).split(".")
    const payload = btoa(JSON.stringify({ email: "intruder@example.test", iss: TEAM, aud: AUD, exp: 9e9 }))
      .replaceAll("=", "")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
    expect(await viaJwt(`${header}.${payload}.${signature}`)).toEqual({
      kind: "unauthenticated",
      reason: "bad-signature",
    })
  })

  it("is unauthenticated for a token that isn't a JWT at all", async () => {
    expect(await viaJwt("not a token")).toEqual({ kind: "unauthenticated", reason: "malformed" })
  })

  it("is unauthenticated for a token that isn't valid yet", async () => {
    const early = await new SignJWT({ email: "andrew@example.test" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setNotBefore("1h")
      .setExpirationTime("2h")
      .sign(privateKey)
    expect(await viaJwt(early)).toEqual({ kind: "unauthenticated", reason: "invalid-claims" })
  })

  it.each([
    ["no email or Client ID", {}],
    ["an empty email", { email: "" }],
    ["an email that isn't a string", { email: 42 }],
  ])("is unauthenticated for a valid token carrying %s", async (_label, claims) => {
    expect(await viaJwt(await sign(claims))).toEqual({ kind: "unauthenticated", reason: "no-identity" })
  })

  it("is unauthenticated when the request carries no token", async () => {
    expect(await callerOf(new Request("https://strix.example.test/api/me"), undefined, SETTINGS, () => keys)).toEqual({
      kind: "unauthenticated",
      reason: "no-token",
    })
  })
})

describe("Access settings that can't verify a token", () => {
  it.each([
    ["the AUD tag is missing", { ACCESS_TEAM_DOMAIN: TEAM }],
    ["the AUD tag is empty", { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: "" }],
    ["the team domain is missing", { ACCESS_AUD: AUD }],
    ["the team domain is empty", { ACCESS_TEAM_DOMAIN: "", ACCESS_AUD: AUD }],
    ["the team domain has a trailing slash", { ACCESS_TEAM_DOMAIN: `${TEAM}/`, ACCESS_AUD: AUD }],
    ["the team domain isn't a URL", { ACCESS_TEAM_DOMAIN: "strix-test", ACCESS_AUD: AUD }],
  ])("refuse every token when %s, rather than skip that check", async (_label, settings) => {
    const refused = { kind: "unauthenticated", reason: "access-unconfigured" }
    const anotherApp = await sign({ email: "andrew@example.test" }, { audience: "another-app" })
    expect(await viaJwt(anotherApp, settings)).toEqual(refused)
    expect(await viaJwt(await sign({ email: "andrew@example.test" }), settings)).toEqual(refused)
  })

  it("refuse a token issued under a plain-HTTP team domain, whose key set anyone on the path could swap", async () => {
    const plainHttpTeam = "http://strix-test.cloudflareaccess.com"
    const forged = await sign({ email: "andrew@example.test" }, { issuer: plainHttpTeam })
    expect(await viaJwt(forged, { ACCESS_TEAM_DOMAIN: plainHttpTeam, ACCESS_AUD: AUD })).toEqual({
      kind: "unauthenticated",
      reason: "access-unconfigured",
    })
  })
})

describe("Cloudflare's signing keys out of reach", () => {
  it.each([
    ["the network fails", new TypeError("Network connection lost")],
    ["the request times out", new errors.JWKSTimeout()],
    [
      "Cloudflare answers with an error",
      new errors.JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response"),
    ],
  ])("makes the caller keys-unavailable, not unauthenticated, when %s", async (_label, failure) => {
    const token = await sign({ email: "andrew@example.test" })
    const unreachable = () => () => Promise.reject(failure)
    expect(await callerOf(carrying(token), undefined, SETTINGS, unreachable)).toEqual({
      kind: "keys-unavailable",
      cause: failure.message,
    })
  })
})

describe("a caller vouched for by ctx.access (vite dev and vite preview)", () => {
  it("is taken from ctx.access, ahead of any JWT and whatever the settings", async () => {
    const caller = await callerOf(carrying("not a token"), stubAccess({ email: "Andrew@Example.test" }), {}, () => keys)
    expect(caller).toEqual({ kind: "user", email: "andrew@example.test" })
  })

  it("falls back to the JWT when ctx.access has no identity", async () => {
    const token = await sign({ email: "emily@example.test" })
    expect(await callerOf(carrying(token), stubAccess(undefined), SETTINGS, () => keys)).toEqual({
      kind: "user",
      email: "emily@example.test",
    })
  })

  it("is unauthenticated when the identity has no email or Client ID", async () => {
    const caller = await callerOf(
      new Request("https://strix.example.test/api/me"),
      stubAccess({ name: "Nobody" }),
      {},
      () => keys,
    )
    expect(caller).toEqual({ kind: "unauthenticated", reason: "no-identity" })
  })
})
