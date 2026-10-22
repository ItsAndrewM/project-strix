const gamePath = (gameId: string) => `/api/games/${encodeURIComponent(gameId)}`

export const probeUrl = (gameId: string) => `${gamePath(gameId)}/probe.jpg`

export const thumbUrl = (gameId: string, clipIndex: number) => `${gamePath(gameId)}/clips/${clipIndex}/thumb.jpg`

export const viewUrl = (gameId: string, clipIndex: number) => `${gamePath(gameId)}/clips/${clipIndex}/view.mp4`
