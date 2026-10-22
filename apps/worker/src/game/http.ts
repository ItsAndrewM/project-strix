import {
  Api,
  Authorization,
  type Crop,
  CurrentUser,
  type Game,
  InvalidInput,
  InvalidInputs,
  invalidInputFrom,
  NotFound,
  Unauthorized,
} from "@strix/contracts"
import { Cause, Effect, ErrorReporter, Layer } from "effect"
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiMiddleware } from "effect/http-api"
import { errorResponse } from "../error-response.ts"
import { logRefusal, routeOf } from "../logs.ts"
import { countsOf, mergedEventsOf, readClips, readGame } from "./store.ts"

export interface GameActions {
  setSource(url: string): Promise<Game>
  start(crop: Crop | null): Promise<Game>
}

export interface GameApi {
  readonly handler: (request: Request) => Promise<Response>
}

const invalidInputs = HttpApiMiddleware.layerSchemaErrorTransform(InvalidInputs, (error) =>
  error.kind === "Body" || error.kind === "ResponseHeaders"
    ? Effect.die(error.cause)
    : Effect.fail(invalidInputFrom(error.cause.issue)),
)

const authorization = Layer.succeed(Authorization, (handler) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const email = request.headers["x-strix-email"]
    if (email === undefined || email === "") {
      logRefusal(routeOf(request.method, request.originalUrl), "no-forwarded-email")
      return yield* new Unauthorized()
    }
    return yield* Effect.provideService(handler, CurrentUser, { email })
  }),
)

const notFoundResponse = () => HttpServerResponse.fromWeb(errorResponse(new NotFound()))

const unknownRoute = HttpRouter.add("*", "/*", () => Effect.sync(notFoundResponse))

const logDefects = ErrorReporter.layer([
  ErrorReporter.make(({ cause, error }) => {
    if (Cause.hasDies(cause)) console.error(error)
  }),
])

const existingGame = (sql: SqlStorage): Effect.Effect<Game, NotFound> =>
  Effect.suspend(() => {
    const game = readGame(sql)
    return game === undefined ? Effect.fail(new NotFound()) : Effect.succeed(game)
  })

const acted = (run: () => Promise<Game>): Effect.Effect<Game, NotFound | InvalidInput> =>
  Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
    Effect.catchIf(
      (error): error is NotFound | InvalidInput => error instanceof NotFound || error instanceof InvalidInput,
      Effect.fail,
      Effect.die,
    ),
  )

const gamesHandlers = (sql: SqlStorage, actions: GameActions) =>
  HttpApiBuilder.group(Api, "games", (handlers) =>
    handlers
      .handleRaw("listGames", () => Effect.sync(notFoundResponse))
      .handleRaw("createGame", () => Effect.sync(notFoundResponse))
      .handle("getGame", () => Effect.map(existingGame(sql), (game) => ({ ...game, counts: countsOf(sql) })))
      .handle("setSource", ({ payload }) => acted(() => actions.setSource(payload.url)))
      .handle("startGame", ({ payload }) => acted(() => actions.start(payload.crop))),
  )

const clipsHandlers = (sql: SqlStorage) =>
  HttpApiBuilder.group(Api, "clips", (handlers) =>
    handlers.handle("listClips", () => Effect.map(existingGame(sql), () => readClips(sql))),
  )

const eventsHandlers = (sql: SqlStorage) =>
  HttpApiBuilder.group(Api, "events", (handlers) =>
    handlers.handle("listEvents", () => Effect.map(existingGame(sql), () => mergedEventsOf(sql))),
  )

export const gameApi = (ctx: DurableObjectState, actions: GameActions): GameApi => {
  const sql = ctx.storage.sql
  const groups = Layer.mergeAll(gamesHandlers(sql, actions), clipsHandlers(sql), eventsHandlers(sql))
  return HttpRouter.toWebHandler(
    Layer.mergeAll(
      HttpApiBuilder.layer(Api).pipe(Layer.provide(groups.pipe(Layer.provide([authorization, invalidInputs])))),
      unknownRoute,
      logDefects,
    ).pipe(Layer.provide(HttpServer.layerServices)),
    { disableLogger: true },
  )
}
