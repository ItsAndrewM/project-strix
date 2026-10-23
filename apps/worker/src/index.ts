import { callerOf, remoteAccessKeys } from "./access.ts"
import { routeApi } from "./api-router.ts"
import { consume } from "./classify/consumer.ts"
import type { ClassifyJob } from "./classify/jobs.ts"
import type { Env } from "./env.ts"

export { GameDO } from "./game/game-do.ts"
export { SlicerContainer } from "./slicer/slicer-container.ts"

export default {
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith("/api/")) return new Response("Not found", { status: 404 })
    const caller = await callerOf(request, ctx.access, env, remoteAccessKeys)
    return routeApi(request, caller, env)
  },
  queue: consume,
} satisfies ExportedHandler<Env, ClassifyJob>
