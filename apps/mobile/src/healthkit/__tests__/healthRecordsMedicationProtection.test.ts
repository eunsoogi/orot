import type { SqlDatabase } from '@orot/storage';
import { guardedNativeDatabase } from '../../storage/protectedReadEpoch';
import { readProtectedMedicationMonth } from '../healthRecordsMedicationLibrary';

const mockAvailable = jest.fn();
const mockOpenOwner = jest.fn();
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: mockAvailable,
  }),
}));

const month = {
  fromInclusive: '2026-09-20T00:00:00Z',
  toInclusive: '2026-10-20T00:00:00Z',
  monthlyTakenOnly: true,
};

test('month denies on device lock without opening any protected source', async () => {
  mockOpenOwner.mockReset();
  mockAvailable.mockReset().mockResolvedValue(false);
  await expect(
    readProtectedMedicationMonth(month, mockOpenOwner),
  ).rejects.toThrow('unavailable');
  expect(mockOpenOwner).not.toHaveBeenCalled();
});

test('a committed writer racing the last protection check retires the month snapshot', async () => {
  const execute = jest.fn(async (query: string) => ({
    rows: /^SELECT/.test(query)
      ? [
          {
            candidates: 0,
            unknown: 0,
            claimed: 0,
            medication_count: 0,
            medication_id: null,
          },
        ]
      : [],
  }));
  const owner = guardedNativeDatabase<SqlDatabase>({
    execute,
    async transaction() {
      throw new Error('Read cannot write.');
    },
  });
  mockOpenOwner.mockReset().mockResolvedValue(owner);
  mockAvailable
    .mockReset()
    .mockResolvedValueOnce(true)
    .mockImplementationOnce(async () => {
      await owner.execute('DELETE FROM dose_events WHERE id = ?', [
        'synthetic',
      ]);
      return true;
    });
  await expect(
    readProtectedMedicationMonth(month, mockOpenOwner),
  ).rejects.toThrow('have changed');
  expect(
    execute.mock.calls.filter(([query]) => query.startsWith('SELECT')),
  ).toHaveLength(1);
  await expect(
    readProtectedMedicationMonth(month, mockOpenOwner),
  ).rejects.toThrow('unavailable');
});
