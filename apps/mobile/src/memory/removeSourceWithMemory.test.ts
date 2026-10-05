import type { AgentMemoryService } from '@orot/agent-memory';
import { openLocalStorage } from '../storage/secureDatabase';
import { removeLocalSourceWithMemory } from './removeSourceWithMemory';

jest.mock('../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));

describe('removeLocalSourceWithMemory', () => {
  const deleteSource = jest.fn<Promise<boolean>, [string]>();

  beforeEach(() => {
    deleteSource.mockReset();
    jest.mocked(openLocalStorage).mockResolvedValue({
      sourceRecords: { delete: deleteSource },
    } as never);
  });

  it('keeps the source record when linked-memory cleanup fails', async () => {
    const events: string[] = [];
    const memory = {
      removeSource: jest.fn(async () => {
        events.push('memory-removal');
        throw new Error('Synthetic memory-storage failure.');
      }),
    } as unknown as AgentMemoryService;

    await expect(
      removeLocalSourceWithMemory('synthetic-source', memory),
    ).rejects.toThrow('Synthetic memory-storage failure.');

    expect(events).toEqual(['memory-removal']);
    expect(deleteSource).not.toHaveBeenCalled();
  });

  it('lets the memory service fence cleanup and source deletion as one operation', async () => {
    const events: string[] = [];
    deleteSource.mockImplementation(async () => {
      events.push('source-delete');
      return true;
    });
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
      removeLocalSourceWithMemory('synthetic-source', memory),
    ).resolves.toEqual({
      sourceDeleted: true,
      memoriesDeleted: 2,
    });

    expect(events).toEqual(['memory-removal', 'source-delete']);
    expect(memory.removeSource).toHaveBeenCalledWith(
      'synthetic-source',
      expect.any(Function),
    );
  });
});
