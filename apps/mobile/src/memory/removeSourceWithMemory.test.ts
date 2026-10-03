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
      forgetBySourceId: jest.fn(async () => {
        events.push('forget');
        throw new Error('Synthetic memory-storage failure.');
      }),
    } as unknown as AgentMemoryService;

    await expect(removeLocalSourceWithMemory('synthetic-source', memory))
      .rejects.toThrow('Synthetic memory-storage failure.');

    expect(events).toEqual(['forget']);
    expect(deleteSource).not.toHaveBeenCalled();
  });
});
