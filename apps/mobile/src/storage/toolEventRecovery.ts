import type { SqlDatabase } from '@orot/storage';
// Several adapters share one connection. Only a new connection is a restart.
const recoveries = new WeakMap<SqlDatabase, Promise<void>>();

/** Run at startup before new requests; legacy quarantine never rewrites the encrypted event. */
export function toolEventRecovery(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async () => {
    await ensure();
    let recovery = recoveries.get(database);
    if (!recovery) {
      recovery = database
        .transaction(async tx => {
          await tx.execute(
            "UPDATE conversation_tool_events SET event_json = json_set(event_json, '$.status', 'interrupted') WHERE json_extract(event_json, '$.status') = 'started'",
          );
        })
        .catch(error => {
          recoveries.delete(database);
          throw error;
        });
      recoveries.set(database, recovery);
    }
    await recovery;
  };
}
