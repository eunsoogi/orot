import { SqliteCheckpointSaver } from '@orot/agent-runtime';
import { createLangGraphCheckpointStorage } from '@orot/storage';
import { openLocalAgentMemoryDatabase } from '../storage/secureDatabase';

let active: Promise<SqliteCheckpointSaver> | null = null;

/** Opens LangGraph checkpoints on the existing encrypted local database. */
export function openLocalWorkflowCheckpointSaver(): Promise<SqliteCheckpointSaver> {
  if (!active) {
    active = openLocalAgentMemoryDatabase()
      .then(database => {
        const storage = createLangGraphCheckpointStorage(database);
        return storage.ensureSchema().then(() => new SqliteCheckpointSaver(storage));
      })
      .catch(error => {
        active = null;
        throw error;
      });
  }
  return active;
}
