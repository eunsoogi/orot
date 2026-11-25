import { createAgentMemory, listSavedMemories } from '@orot/agent-memory';
import type { SqlDatabase } from '@orot/storage';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { readHistoricalSavedMemory } from '../../storage/readHistoricalSavedMemory';
import {
  checkProtection,
  historicalMemoryFixture,
  nativeListeners,
  resetHistoricalProtectionMock,
} from '../testSupport/historicalMemoryFixture';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative');
jest.mock('@orot/agent-memory', () => ({
  ...jest.requireActual('@orot/agent-memory'),
  createAgentMemory: jest.fn(() => {
    throw new Error('Historical read cannot open a model engine.');
  }),
}));
beforeEach(resetHistoricalProtectionMock);

test.each([
  'settled',
  'silent lock',
  'lock then unlock',
  'owner replaced',
] as const)(
  'selected real re-reviewed SQLite memory stays protected across initial contention: %s',
  async scenario => {
    const f = await historicalMemoryFixture(true);
    // Production lists eligible memory and its withheld metadata before the
    // user can choose the historical detail. That pass persists quarantine.
    expect(await listSavedMemories(f.storage)).toEqual([]);
    expect(await f.storage.listUnavailableMetadata()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: f.id })]),
    );
    await f.db.execute(
      'CREATE TABLE synthetic_historical_pending(value INTEGER)',
    );
    await f.db.execute('INSERT INTO synthetic_historical_pending VALUES(0)');
    let started = () => {};
    let release = () => {};
    const dispatched = new Promise<void>(resolve => (started = resolve));
    const pending = new Promise<void>(resolve => (release = resolve));
    const statement = 'UPDATE synthetic_historical_pending SET value=1';
    const database = guardedNativeDatabase<SqlDatabase>({
      async execute(query, params) {
        if (query === statement) {
          started();
          await pending;
        }
        return f.db.execute(query, params);
      },
      transaction: f.db.transaction.bind(f.db),
    });
    const open = jest.mocked(openLocalAgentMemoryDatabase);
    open.mockClear().mockResolvedValue(database);
    const writer = database.execute(statement);
    await dispatched;
    const presented = jest.fn();
    const read = readHistoricalSavedMemory(f.id).then(value => {
      presented(value);
      return value;
    });
    try {
      await new Promise<void>(done => setImmediate(done));
      expect(presented).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledTimes(1);
      if (scenario === 'silent lock') checkProtection.mockResolvedValue(false);
      if (scenario === 'lock then unlock') {
        for (const notify of nativeListeners) {
          notify({ kind: 'protectedData', available: false });
          notify({ kind: 'protectedData', available: true });
        }
        await expect(read).resolves.toBeNull();
      }
      if (scenario === 'owner replaced') open.mockResolvedValue(f.guarded);
      release();
      await writer;
      await expect(read).resolves.toEqual(
        scenario === 'settled'
          ? { id: f.id, createdAt: f.retained.createdAt, text: f.retained.text }
          : null,
      );
      expect(createAgentMemory).not.toHaveBeenCalled();
      expect(
        (await f.db.execute('SELECT value FROM synthetic_historical_pending'))
          .rows,
      ).toEqual([{ value: 1 }]);
      expect(
        (await f.db.execute('SELECT record_json FROM agent_memory_records'))
          .rows,
      ).toEqual([{ record_json: f.raw }]);
    } finally {
      release();
      await Promise.allSettled([writer, read]);
      f.close();
    }
  },
);
