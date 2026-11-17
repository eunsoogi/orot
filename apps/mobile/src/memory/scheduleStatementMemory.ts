import { AppState } from 'react-native';
import type { SqlDatabase } from '@orot/storage';
import type { AgentMemoryService } from '@orot/agent-memory';
type Memory = Pick<AgentMemoryService, 'remember'>;
type Runtime = {
  open(): Promise<Memory>;
  enqueue(database: SqlDatabase): Promise<void>;
  process(
    database: SqlDatabase,
    memory: Memory,
    active: () => boolean,
  ): Promise<unknown>;
};
async function loadRuntime(): Promise<Runtime> {
  const [{ openLocalAgentMemory }, { localMemoryProvider }, processor] =
    await Promise.all([
      import('./localAgentMemory'),
      import('./localMemoryProvider'),
      import('./userStatementMemoryProcessing'),
    ]);
  return {
    open: () => openLocalAgentMemory(localMemoryProvider()),
    enqueue: processor.enqueueExistingHistoryMemories,
    process: processor.processStatementMemoryJobs,
  };
}

/** One bounded local worker per database. Source checks, not this process-local
 * scheduler, fence deletion races. Dependencies also permit deterministic lifecycle tests. */
export function createStatementMemoryScheduler(
  load: () => Promise<Runtime>,
  active: () => boolean,
) {
  const running = new WeakMap<SqlDatabase, Promise<void>>();
  return function schedule(
    database: SqlDatabase,
    ownerCurrent: () => boolean = () => true,
  ): Promise<void> {
    const admitted = () => active() && ownerCurrent();
    const existing = running.get(database);
    if (existing) return existing;
    if (!admitted()) return Promise.resolve();
    const work = (async () => {
      const runtime = await load();
      if (!admitted()) return;
      const memory = await runtime.open();
      if (!admitted()) return;
      await runtime.enqueue(database);
      if (!admitted()) return;
      await runtime.process(database, memory, admitted);
    })();
    const settled = work
      .catch(() => {
        // Originals and queued identities survive; failure cannot fail an already saved answer.
      })
      .finally(() => {
        if (running.get(database) === settled) running.delete(database);
      });
    running.set(database, settled);
    return settled;
  };
}

/** No remote extraction or extra transmission. Pending work retries on the next
 * answer/Memory entry. Bounded on-device embedding never delays answer delivery. */
export const scheduleStatementMemory = createStatementMemoryScheduler(
  loadRuntime,
  () => AppState.currentState === 'active',
);
type AppendingStorage = Pick<
  ReturnType<
    typeof import('../storage/conversationArtifactStorage').createConversationArtifactStorage
  >,
  'append'
>;
export function withStatementMemory<T extends AppendingStorage>(
  storage: T,
  database: SqlDatabase,
  schedule = scheduleStatementMemory,
): T {
  return {
    ...storage,
    async append(...args: Parameters<AppendingStorage['append']>) {
      const result = await storage.append(...args);
      setTimeout(() => {
        schedule(database);
      }, 0);
      return result;
    },
  };
}
