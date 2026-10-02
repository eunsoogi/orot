export type SqlValue = string | number | boolean | null | ArrayBuffer | ArrayBufferView;

export interface SqlResult {
  rows: Array<Record<string, SqlValue>>;
  rowsAffected?: number;
}

export interface SqlExecutor {
  execute(query: string, parameters?: SqlValue[]): Promise<SqlResult>;
}

export interface SqlTransaction extends SqlExecutor {
  commit(): SqlResult;
  rollback(): SqlResult;
}

export interface SqlDatabase extends SqlExecutor {
  transaction(operation: (transaction: SqlTransaction) => Promise<void>): Promise<void>;
  closeAsync?: () => Promise<void>;
}
