import { Context, Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, OpenApi } from "effect/http-api"
import { Clip } from "./clip.ts"
import { InvalidInput, NotFound, Unauthorized } from "./errors.ts"
import { GameEvent } from "./event.ts"
import { Crop, Game, NewGame } from "./game.ts"

export class CurrentUser extends Context.Service<CurrentUser, { readonly email: string }>()("strix/CurrentUser") {}

export class Authorization extends HttpApiMiddleware.Service<Authorization, { provides: CurrentUser }>()(
  "strix/Authorization",
  { error: Unauthorized },
) {}

export class InvalidInputs extends HttpApiMiddleware.Service<InvalidInputs>()("strix/InvalidInputs", {
  error: InvalidInput,
}) {}

const byId = { id: Schema.String }

export class GamesGroup extends HttpApiGroup.make("games")
  .add(HttpApiEndpoint.get("listGames", "/games", { success: Schema.Array(Game) }))
  .add(HttpApiEndpoint.post("createGame", "/games", { payload: NewGame, success: Game }))
  .add(HttpApiEndpoint.get("getGame", "/games/:id", { params: byId, success: Game, error: NotFound }))
  .add(
    HttpApiEndpoint.post("setSource", "/games/:id/source", {
      params: byId,
      payload: Schema.Struct({ url: Schema.String }),
      success: Game,
      error: NotFound,
    }),
  )
  .add(
    HttpApiEndpoint.post("startGame", "/games/:id/start", {
      params: byId,
      payload: Schema.Struct({ crop: Schema.NullOr(Crop) }),
      success: Game,
      error: NotFound,
    }),
  ) {}

export class ClipsGroup extends HttpApiGroup.make("clips").add(
  HttpApiEndpoint.get("listClips", "/games/:id/clips", {
    params: byId,
    success: Schema.Array(Clip),
    error: NotFound,
  }),
) {}

export class EventsGroup extends HttpApiGroup.make("events").add(
  HttpApiEndpoint.get("listEvents", "/games/:id/events", {
    params: byId,
    success: Schema.Array(GameEvent),
    error: NotFound,
  }),
) {}

export class Api extends HttpApi.make("strix")
  .add(GamesGroup)
  .add(ClipsGroup)
  .add(EventsGroup)
  .prefix("/api")
  .middleware(InvalidInputs)
  .middleware(Authorization)
  .annotate(HttpApi.ParseOptions, { errors: "all" })
  .annotate(OpenApi.Title, "Strix") {}
