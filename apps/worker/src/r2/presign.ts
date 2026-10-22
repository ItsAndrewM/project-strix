import { AwsClient } from "aws4fetch"
import type { Env } from "../env.ts"

export interface Urls {
  get(key: string): Promise<string>
  put(key: string): Promise<string>
}

const BUCKET_NAME = "strix"
const URL_LIFETIME_SECONDS = 3600

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value === "") throw new Error(`${name} is not set`)
  return value
}

const presign = async (env: Env, method: "GET" | "PUT", key: string, expiresSeconds: number): Promise<string> => {
  const client = new AwsClient({
    accessKeyId: required("R2_ACCESS_KEY_ID", env.R2_ACCESS_KEY_ID),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY", env.R2_SECRET_ACCESS_KEY),
    service: "s3",
    region: "auto",
  })
  const url = new URL(`${required("R2_ENDPOINT", env.R2_ENDPOINT)}/${BUCKET_NAME}/${key}`)
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds))
  const signed = await client.sign(new Request(url, { method }), { aws: { signQuery: true } })
  return signed.url
}

export const presignGet = (env: Env, key: string, expiresSeconds: number): Promise<string> =>
  presign(env, "GET", key, expiresSeconds)

export const presignPut = (env: Env, key: string, expiresSeconds: number): Promise<string> =>
  presign(env, "PUT", key, expiresSeconds)

const fixtureUrl = (key: string): Promise<string> => Promise.resolve(`r2://${key}`)

export const urlsFor = (env: Env): Urls =>
  env.FIXTURES === "1"
    ? { get: fixtureUrl, put: fixtureUrl }
    : {
        get: (key) => presignGet(env, key, URL_LIFETIME_SECONDS),
        put: (key) => presignPut(env, key, URL_LIFETIME_SECONDS),
      }
