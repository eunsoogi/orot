import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository, SqlDatabase } from '@orot/storage';
import { createLocalE5RagService } from '../../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { RecordingDeletionTimingProbe } from '../../recording/recordingDeletionTimingProbe';
import { removeLocalSourceWithMemory } from '../removeSourceWithMemory';

jest.mock('../../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

const sourceId = '123e4567-e89b-12d3-a456-426614174001';

function setup(now: { value: number }) {
  const database = {} as SqlDatabase;
  const repository = {
    listSourceDeletionReferences: jest.fn(async () => {
      now.value += 5;
      return [];
    }),
    sourceRecords: {
      delete: jest.fn(
        async (
          _id: string,
          deleteDerived: (transaction: unknown) => Promise<void>,
        ) => {
          await deleteDerived({});
          now.value += 11;
          return true;
        },
      ),
    },
  } as unknown as RecordRepository;
  const rag = {
    prepare: jest.fn(async () => {
      now.value += 3;
    }),
    deleteChunks: jest.fn(async () => {
      now.value += 2;
    }),
  };

  jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(database);
  jest.mocked(openLocalStorage).mockResolvedValue(repository);
  jest.mocked(createLocalE5RagService).mockReturnValue(rag as never);

  const memory = {
    removeSource: jest.fn(
      async (_id: string, deleteSource: () => Promise<boolean>) => {
        now.value += 7;
        return {
          sourceDeleted: await deleteSource(),
          memoriesDeleted: 1,
        };
      },
    ),
  } as unknown as AgentMemoryService;
  return { database, memory, rag, repository };
}

test('separates derived cleanup from the source database commit', async () => {
  const now = { value: 0 };
  const { memory, rag, repository } = setup(now);
  const probe = new RecordingDeletionTimingProbe(() => now.value);
  probe.mark('confirmation-tap');

  const result = await removeLocalSourceWithMemory(sourceId, memory, probe);
  probe.finish('success');
  probe.mark('list-refresh');

  expect(result).toEqual({ sourceDeleted: true, memoriesDeleted: 1 });
  expect(rag.prepare).toHaveBeenCalledTimes(1);
  expect(repository.listSourceDeletionReferences).toHaveBeenCalledWith(
    sourceId,
  );
  expect(repository.sourceRecords.delete).toHaveBeenCalledTimes(1);
  expect(probe.snapshot().durationsMs).toMatchObject({
    derivedDataCleanup: 15,
    databaseDeleteCommit: 13,
  });
  expect(
    probe.snapshot().events.map(event => [event.stage, event.phase]),
  ).toEqual([
    ['confirmation-tap', 'mark'],
    ['derived-data-cleanup', 'begin'],
    ['derived-data-cleanup', 'end'],
    ['database-delete-commit', 'begin'],
    ['database-delete-commit', 'end'],
    ['list-refresh', 'mark'],
  ]);
  expect(JSON.stringify(probe.snapshot())).not.toContain(sourceId);
});

test('closes a failed derived cleanup span without invoking the source commit', async () => {
  const now = { value: 0 };
  const { memory, rag, repository } = setup(now);
  const failure = new Error('RAG preparation failed');
  jest.mocked(rag.prepare).mockRejectedValueOnce(failure);
  const probe = new RecordingDeletionTimingProbe(() => now.value);
  probe.mark('confirmation-tap');

  await expect(
    removeLocalSourceWithMemory(sourceId, memory, probe),
  ).rejects.toBe(failure);

  expect(repository.sourceRecords.delete).not.toHaveBeenCalled();
  expect(memory.removeSource).not.toHaveBeenCalled();
  expect(probe.snapshot().events).toEqual([
    {
      stage: 'confirmation-tap',
      phase: 'mark',
      elapsedMs: 0,
    },
    {
      stage: 'derived-data-cleanup',
      phase: 'begin',
      elapsedMs: 0,
    },
    {
      stage: 'derived-data-cleanup',
      phase: 'end',
      elapsedMs: 0,
      outcome: 'failure',
    },
  ]);
});
