import type { AgentMemoryService } from '@orot/agent-memory';
import type { RecordRepository, SqlExecutor } from '@orot/storage';
import { createLocalE5RagService } from '../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { removeAllLocalDataWithMemory } from './removeAllLocalDataWithMemory';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

jest.mock('../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));

describe('removeAllLocalDataWithMemory', () => {
  const sourceRecordIds = ['synthetic-source-1', 'synthetic-source-2'];
  type DeletedLocalDataReferences = Awaited<
    ReturnType<RecordRepository['deleteAllLocalData']>
  >;
  const deleted: DeletedLocalDataReferences = {
    sourceRecordIds,
  };
  const transaction = { execute: jest.fn() } as unknown as SqlExecutor;
  const events: string[] = [];
  const prepare = jest.fn<Promise<void>, []>();
  const clear = jest.fn<Promise<void>, [readonly string[], SqlExecutor]>();
  const deleteAllLocalData = jest.fn<
    Promise<DeletedLocalDataReferences>,
    [
      (
        transaction: SqlExecutor,
        sourceRecordIds: readonly string[],
      ) => Promise<void>,
    ]
  >();

  beforeEach(() => {
    events.length = 0;
    prepare.mockReset().mockImplementation(async () => {
      events.push('rag-prepare');
    });
    clear.mockReset().mockImplementation(async () => {
      events.push('rag-clear');
    });
    deleteAllLocalData
      .mockReset()
      .mockImplementation(async clearRelatedData => {
        events.push('local-delete');
        await clearRelatedData(transaction, sourceRecordIds);
        return deleted;
      });
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue({} as never);
    jest.mocked(openLocalStorage).mockResolvedValue({
      list: jest.fn().mockResolvedValue(sourceRecordIds.map(id => ({ id }))),
      deleteAllLocalData,
    } as never);
    jest
      .mocked(createLocalE5RagService)
      .mockReturnValue({ prepare, clear } as never);
  });

  it('forgets memory before clearing local records and shared-transaction RAG state', async () => {
    const memory = {
      forgetAll: jest.fn(async () => {
        events.push('memory-forget-all');
        return 3;
      }),
    } as unknown as AgentMemoryService;

    await expect(removeAllLocalDataWithMemory(memory)).resolves.toEqual({
      ...deleted,
      memoriesDeleted: 3,
    });

    expect(events).toEqual([
      'rag-prepare',
      'memory-forget-all',
      'local-delete',
      'rag-clear',
    ]);
    expect(memory.forgetAll).toHaveBeenCalledWith(sourceRecordIds);
    expect(clear).toHaveBeenCalledWith(sourceRecordIds, transaction);
  });

  it('keeps source records when persistent memory removal fails', async () => {
    const memory = {
      forgetAll: jest
        .fn()
        .mockRejectedValue(new Error('Synthetic memory-storage failure.')),
    } as unknown as AgentMemoryService;

    await expect(removeAllLocalDataWithMemory(memory)).rejects.toThrow(
      'Synthetic memory-storage failure.',
    );

    expect(deleteAllLocalData).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});
