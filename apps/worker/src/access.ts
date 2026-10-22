import { Option, Schema } from "effect"
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose"

export type Refusal =
  | "no-token"
  | "access-unconfigured"
  | "malformed"
  | "wrong-algorithm"
  | "unknown-key"
  | "bad-signature"
  | "expired"
  | "wrong-issuer"
  | "wrong-audience"
  | "invalid-claims"
  | "no-identity"

export type Caller =
  | { readonly kind: "user"; readonly email: string }
  | { readonly kind: "service"; readonly clientId: string }
  | { readonly kind: "unauthenticated"; readonly reason: Refusal }
  | { readonly kind: "keys-unavailable"; readonly cause: string }

export interface AccessSettings {
  readonly ACCESS_TEAM_DOMAIN?: string
  readonly ACCESS_AUD?: string
}

export type AccessKeysFor = (teamDomain: string) => JWTVerifyGetKey

const refused = (reason: Refusal): Caller => ({ kind: "unauthenticated", reason })

const HttpsOrigin = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      const parsed = URL.parse(value)
      return parsed?.protocol === "https:" && parsed.origin === value
    },
    { expected: "an https origin like https://team.cloudflareaccess.com" },
  ),
)

const JwtSettings = Schema.Struct({ ACCESS_TEAM_DOMAIN: HttpsOrigin, ACCESS_AUD: Schema.NonEmptyString })
const jwtSettingsOf = Schema.decodeUnknownOption(JwtSettings)

const Claims = Schema.Struct({ email: Schema.optional(Schema.String), common_name: Schema.optional(Schema.String) })
const claimsOf = Schema.decodeUnknownOption(Claims)

const callerFrom = ({ email, common_name }: typeof Claims.Type): Caller => {
  if (email !== undefined && email !== "") return { kind: "user", email: email.toLowerCase() }
  if (common_name !== undefined && common_name !== "") return { kind: "service", clientId: common_name }
  return refused("no-identity")
}

const callerFromClaims = (claims: JWTPayload | CloudflareAccessIdentity): Caller =>
  Option.match(claimsOf(claims), { onNone: () => refused("no-identity"), onSome: callerFrom })

const REFUSALS = new Map<string, Refusal>([
  ["ERR_JOSE_ALG_NOT_ALLOWED", "wrong-algorithm"],
  ["ERR_JWKS_NO_MATCHING_KEY", "unknown-key"],
  ["ERR_JWKS_MULTIPLE_MATCHING_KEYS", "unknown-key"],
  ["ERR_JWS_SIGNATURE_VERIFICATION_FAILED", "bad-signature"],
  ["ERR_JWT_EXPIRED", "expired"],
])

const CLAIM_REFUSALS = new Map<string, Refusal>([
  ["iss", "wrong-issuer"],
  ["aud", "wrong-audience"],
])

const refusalOf = (error: errors.JOSEError): Refusal =>
  error instanceof errors.JWTClaimValidationFailed
    ? (CLAIM_REFUSALS.get(error.claim) ?? "invalid-claims")
    : (REFUSALS.get(error.code) ?? "malformed")

class AccessKeysUnavailable extends Error {}

const reportingOutages =
  (keys: JWTVerifyGetKey): JWTVerifyGetKey =>
  async (header, token) => {
    try {
      return await keys(header, token)
    } catch (error) {
      if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) throw error
      throw new AccessKeysUnavailable(error instanceof Error ? error.message : "the key set couldn't be read")
    }
  }

const verifiedCaller = async (
  token: string,
  settings: typeof JwtSettings.Type,
  keys: JWTVerifyGetKey,
): Promise<Caller> => {
  try {
    const { payload } = await jwtVerify(token, reportingOutages(keys), {
      issuer: settings.ACCESS_TEAM_DOMAIN,
      audience: settings.ACCESS_AUD,
      algorithms: ["RS256"],
    })
    return callerFromClaims(payload)
  } catch (error) {
    if (error instanceof AccessKeysUnavailable) return { kind: "keys-unavailable", cause: error.message }
    return refused(error instanceof errors.JOSEError ? refusalOf(error) : "malformed")
  }
}

export const callerOf = async (
  request: Request,
  access: CloudflareAccessContext | undefined,
  settings: AccessSettings,
  keysFor: AccessKeysFor,
): Promise<Caller> => {
  const identity = await access?.getIdentity()
  if (identity !== undefined) return callerFromClaims(identity)
  const token = request.headers.get("cf-access-jwt-assertion")
  if (token === null) return refused("no-token")
  const jwt = jwtSettingsOf(settings)
  if (Option.isNone(jwt)) return refused("access-unconfigured")
  return verifiedCaller(token, jwt.value, keysFor(jwt.value.ACCESS_TEAM_DOMAIN))
}

const remoteKeys = new Map<string, JWTVerifyGetKey>()

export const remoteAccessKeys: AccessKeysFor = (teamDomain) => {
  const cached = remoteKeys.get(teamDomain)
  if (cached !== undefined) return cached
  const keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", teamDomain))
  remoteKeys.set(teamDomain, keys)
  return keys
}
