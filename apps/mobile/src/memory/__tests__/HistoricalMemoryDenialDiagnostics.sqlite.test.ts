import { providerDiagnostic } from '../../providers/diagnostics';
import { readHistoricalSavedMemory } from '../../storage/readHistoricalSavedMemory';
import {
  historicalMemoryFixture,
  invalidateHistoricalMemoryFixture,
  resetHistoricalProtectionMock,
} from '../testSupport/historicalMemoryFixture';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));
jest.mock('../../ragConversation/conversationExecutionNative');
jest.mock('@orot/agent-memory', () => ({
  ...jest.requireActual('@orot/agent-memory'),
  createAgentMemory: jest.fn(() => {
    throw new Error('A protected historical read must not open a model.');
  }),
}));
jest.mock('../../providers/diagnostics', () => ({
  ...jest.requireActual('../../providers/diagnostics'),
  providerDiagnostic: jest.fn(),
}));

beforeEach(resetHistoricalProtectionMock);

test.each([
  ['malformed provenance', 'saved_memory_historical_shape'],
  ['non-owner review', 'saved_memory_historical_authority'],
  ['explicit source tombstone', 'saved_memory_historical_revoked'],
])(
  'diagnoses %s without exposing the retained record',
  async (boundary, stage) => {
    const file = await historicalMemoryFixture();
    jest.mocked(providerDiagnostic).mockClear();
    try {
      expect(await file.storage.listRecords()).toEqual([]);
      expect(await file.storage.listUnavailableMetadata()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: file.id })]),
      );
      await invalidateHistoricalMemoryFixture(file, boundary);
      expect(await readHistoricalSavedMemory(file.id)).toBeNull();
      expect(
        jest
          .mocked(providerDiagnostic)
          .mock.calls.filter(([, token]) =>
            token.startsWith('saved_memory_historical_'),
          ),
      ).toEqual([['storage', stage, 'failed']]);
    } finally {
      file.close();
    }
  },
);
