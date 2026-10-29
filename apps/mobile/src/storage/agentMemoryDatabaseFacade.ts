import type { SqlDatabase } from '@orot/storage';

const facades = new WeakMap<SqlDatabase, SqlDatabase>();

/** Preserve connection identity for schema caches without exposing native close, delete or key access. */
export function agentMemoryDatabaseFacade(
  connection: SqlDatabase,
): SqlDatabase {
  const existing = facades.get(connection);
  if (existing) return existing;

  // Capture this connection, never the mutable active connection: an old facade cannot redirect after another open.
  const facade: SqlDatabase = {
    execute: (query, parameters) => connection.execute(query, parameters),
    transaction: operation => connection.transaction(operation),
  };
  // No await separates lookup and publication; concurrent successful opens receive this same facade.
  facades.set(connection, facade);
  return facade;
}
