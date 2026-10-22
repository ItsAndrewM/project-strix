import { callerOf, remoteAccessKeys } from "./access.ts"
import { routeApi } from "./api-router.ts"
import type { ClassifyMessage, Env } from "./env.ts"

export { GameDO } from "./game/game-do.ts"
export { SlicerContainer } from "./slicer/slicer-container.ts"

const ackAll = (batch: MessageBatch<ClassifyMessage>): void => {
  for (const message of batch.messages) message.ack()
}

export default {
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith("/api/")) return new Response("Not found", { status: 404 })
    const caller = await callerOf(request, ctx.access, env, remoteAccessKeys)
    return routeApi(request, caller, env)
  },
  queue: ackAll,
} satisfies ExportedHandler<Env, ClassifyMessage>
