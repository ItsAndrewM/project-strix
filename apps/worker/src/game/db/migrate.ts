export interface Migration {
  readonly name: string
  readonly sql: string
}

const LEDGER = `CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT`

export const appliedNames = (sql: SqlStorage): string[] =>
  sql
    .exec<{ name: string }>("SELECT name FROM _migrations ORDER BY id")
    .toArray()
    .map(({ name }) => name)

const checkLedger = (applied: ReadonlyArray<string>, migrations: ReadonlyArray<Migration>): void => {
  applied.forEach((name, index) => {
    const known = migrations[index]
    if (known !== undefined && known.name !== name) {
      throw new Error(`Migration ${index + 1} is "${name}" in this game, but "${known.name}" in the code`)
    }
  })
}

export const migrate = (storage: DurableObjectStorage, migrations: ReadonlyArray<Migration>, now: number): void => {
  storage.sql.exec(LEDGER)
  const applied = appliedNames(storage.sql)
  checkLedger(applied, migrations)
  migrations.slice(applied.length).forEach(({ name, sql }, index) =>
    storage.transactionSync(() => {
      storage.sql.exec(sql)
      storage.sql.exec(
        "INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)",
        applied.length + index + 1,
        name,
        now,
      )
    }),
  )
}
