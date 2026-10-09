import type { AgentMemoryService } from '@orot/agent-memory';
import type { SqlExecutor } from '@orot/storage';
import { createLocalE5RagService } from '../rag/localE5RagService';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../storage/secureDatabase';
import { removeLocalSourceWithMemory } from './removeSourceWithMemory';

jest.mock('../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

jest.mock('../rag/localE5RagService', () => ({
  createLocalE5RagService: jest.fn(),
}));

describe('removeLocalSourceWithMemory', () => {
  const events: string[] = [];
  const sourceId = 'synthetic-source';
  // The deletion callback must forward the repository transaction to RAG cleanup.
  const transaction = { execute: jest.fn() } as unknown as SqlExecutor;
  const prepare = jest.fn<Promise<void>, []>();
  const deleteChunks = jest.fn<
    Promise<void>,
    [unknown[], string[], SqlExecutor]
  >();
  const deleteSource = jest.fn<
    Promise<boolean>,
    [string, ((transaction: SqlExecutor) => Promise<void>)?]
  >();
  const listSourceDeletionReferences = jest.fn<
    Promise<readonly string[]>,
    [string]
  >();

  beforeEach(() => {
    events.length = 0;
    prepare.mockReset().mockImplementation(async () => {
      events.push('rag-prepare');
    });
    deleteChunks.mockReset().mockImplementation(async () => {
      events.push('rag-delete');
    });
    deleteSource.mockReset().mockImplementation(async (_sourceId, cleanup) => {
      events.push('source-delete');
      await cleanup?.(transaction);
      return true;
    });
    listSourceDeletionReferences
      .mockReset()
      .mockResolvedValue([
        'synthetic-source',
        'transcript:0:r1',
        'evidence-span',
      ]);
    jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue({} as never);
    jest.mocked(openLocalStorage).mockResolvedValue({
      sourceRecords: { delete: deleteSource },
      listSourceDeletionReferences,
    } as never);
    jest.mocked(createLocalE5RagService).mockReturnValue({
      prepare,
      deleteChunks,
    } as never);
  });

  it('keeps the source record when linked-memory cleanup fails', async () => {
    const memory = {
      removeSource: jest.fn(async () => {
        events.push('memory-removal');
        throw new Error('Synthetic memory-storage failure.');
      }),
    } as unknown as AgentMemoryService;

    await expect(removeLocalSourceWithMemory(sourceId, memory)).rejects.toThrow(
      'Synthetic memory-storage failure.',
    );

    expect(events).toEqual(['rag-prepare', 'memory-removal']);
    expect(deleteSource).not.toHaveBeenCalled();
    expect(deleteChunks).not.toHaveBeenCalled();
  });

  it('prepares RAG first and deletes source vectors in the source transaction', async () => {
    const memory = {
      removeSource: jest.fn(
        async (
          _sourceId: string,
          deleteSourceRecord: () => Promise<boolean>,
        ) => {
          events.push('memory-removal');
          const sourceDeleted = await deleteSourceRecord();
          return { sourceDeleted, memoriesDeleted: 2 };
        },
      ),
    } as unknown as AgentMemoryService;

    await expect(
      removeLocalSourceWithMemory(sourceId, memory),
    ).resolves.toEqual({
      sourceDeleted: true,
      memoriesDeleted: 2,
    });

    expect(events).toEqual([
      'rag-prepare',
      'memory-removal',
      'source-delete',
      'rag-delete',
    ]);
    expect(deleteSource).toHaveBeenCalledWith(sourceId, expect.any(Function));
    expect(deleteChunks).toHaveBeenCalledWith([], [sourceId], transaction);
  });

  it('normalizes one source ID before memory, dependency lookup, SQL, and RAG cleanup', async () => {
    const memory = {
      removeSource: jest.fn(
        async (
          _sourceId: string,
          deleteSourceRecord: () => Promise<boolean>,
        ) => {
          events.push('memory-removal');
          const sourceDeleted = await deleteSourceRecord();
          return { sourceDeleted, memoriesDeleted: 1 };
        },
      ),
    } as unknown as AgentMemoryService;

    await removeLocalSourceWithMemory(' synthetic-source ', memory);

    expect(listSourceDeletionReferences).toHaveBeenCalledWith(
      'synthetic-source',
    );
    expect(memory.removeSource).toHaveBeenCalledWith(
      'synthetic-source',
      expect.any(Function),
      ['synthetic-source', 'transcript:0:r1', 'evidence-span'],
    );
    expect(deleteSource).toHaveBeenCalledWith(
      'synthetic-source',
      expect.any(Function),
    );
    expect(deleteChunks).toHaveBeenCalledWith(
      [],
      ['synthetic-source'],
      transaction,
    );
  });
});
