import { Predicate, Schema, SchemaIssue, type StandardSchema } from "effect"

export const FieldIssue = Schema.Literals(["invalid"])
export type FieldIssue = typeof FieldIssue.Type

export const FieldError = Schema.Struct({ path: Schema.String, issue: FieldIssue })
export type FieldError = typeof FieldError.Type

export class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}, { httpApiStatus: 401 }) {}

export class InvalidInput extends Schema.TaggedError<InvalidInput>()(
  "InvalidInput",
  { fieldErrors: Schema.Array(FieldError) },
  { httpApiStatus: 400 },
) {}

const leafIssues = SchemaIssue.makeFormatterStandardSchemaV1()

const keyOf = (segment: PropertyKey | StandardSchema.StandardSchemaV1.PathSegment) =>
  String(Predicate.isObject(segment) ? segment.key : segment)

export const invalidInputFrom = (issue: SchemaIssue.Issue): InvalidInput => {
  const paths = new Set(leafIssues(issue).issues.map(({ path = [] }) => path.map(keyOf).join(".")))
  return new InvalidInput({ fieldErrors: [...paths].map((path) => ({ path, issue: "invalid" })) })
}

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {}, { httpApiStatus: 404 }) {}

export class ServiceUnavailable extends Schema.TaggedError<ServiceUnavailable>()(
  "ServiceUnavailable",
  {},
  { httpApiStatus: 503 },
) {}
