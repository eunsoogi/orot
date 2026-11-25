import {
  manualHistoryMemoryDelete,
  savedMemoryDeleteExecutor,
} from '../storage/guardedMutationBoundary';
import type { SqlExecutor } from '@orot/storage';
import type { SavedMemoryDeletionTrace } from './savedMemoryDeletionDiagnostics';

/** Only known lineage statements get fixed markers. This wraps the already
 * acquired executor, never opens a second connection or forwards SQL or IDs
 * to diagnostics. A DELETE spans native triggers and foreign-key cascades. */
export function observeManualHistoryDeletionSql(
  owner: SqlExecutor,
  trace: SavedMemoryDeletionTrace,
): SqlExecutor {
  return {
    async execute(query, parameters) {
      const stage = query.startsWith(
        'DELETE FROM manual_history_entries WHERE ',
      )
        ? 'saved_memory_delete_sql'
        : query.endsWith('FROM manual_history_entries WHERE id = ? LIMIT 1')
          ? 'saved_memory_delete_record'
          : query.endsWith(
                'FROM manual_history_entries WHERE supersedes_id = ? LIMIT 2',
              )
            ? 'saved_memory_delete_successor'
            : null;
      if (!stage) return owner.execute(query, parameters);
      trace(stage, 'started');
      try {
        const traced =
          query === manualHistoryMemoryDelete &&
          savedMemoryDeleteExecutor(owner);
        const result = await (traced &&
        parameters?.length === 1 &&
        typeof parameters[0] === 'string'
          ? traced(parameters[0])
          : owner.execute(query, parameters));
        trace(stage, 'completed');
        return result;
      } catch (error) {
        trace(stage, 'failed');
        throw error;
      }
    },
  };
}
