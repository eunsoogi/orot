import { createManualHistoryRepository } from '@orot/storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../storage/secureDatabase';
import { SqlCipherRagEmbeddingStorage } from '../../storage/ragEmbeddingStorage';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import { unifySavedMemories } from '../unifiedSavedMemories';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));
jest.mock('../../storage/ragEmbeddingStorage', () => ({
  SqlCipherRagEmbeddingStorage: {
    forCallerTransaction: jest
      .fn()
      .mockResolvedValue({ deleteEvidence: jest.fn() }),
  },
}));

test.each(['stale', 'current'] as const)(
  'Settings confirms only the exact selected history tip: %s',
  async selection => {
    jest.clearAllMocks();
    const prior = AppState.currentState;
    AppState.currentState = 'active';
    const f = await healthContextFixture();
    try {
      const repository = createManualHistoryRepository(f.database);
      jest
        .mocked(openLocalStorage)
        .mockResolvedValue({ manualHistory: repository } as Awaited<
          ReturnType<typeof openLocalStorage>
        >);
      jest.mocked(openLocalAgentMemoryDatabase).mockResolvedValue(f.database);
      const original = await repository.create({
        kind: 'note',
        title: 'Synthetic original',
        details: 'Uncertain synthetic history',
        effectiveDate: { status: 'unknown' },
      });
      const load = async () => unifySavedMemories([], await repository.list());
      await render(
        <SavedMemoryDetail
          memoryId={'manual-history:' + original.id}
          load={load}
        />,
      );
      await fireEvent.press(await screen.findByTestId('manual-history-delete'));
      const corrected =
        selection === 'stale'
          ? await repository.correct(original.id, {
              kind: 'note',
              title: 'Synthetic corrected',
              details: 'New synthetic details',
              effectiveDate: { status: 'known', date: '2026-10-01' },
            })
          : null;
      await fireEvent.press(
        screen.getByTestId('manual-history-confirm-delete'),
      );
      expect(await repository.list()).toEqual(corrected ? [corrected] : []);
      if (corrected) {
        expect(await repository.history(original.id)).toEqual([
          original,
          corrected,
        ]);
        expect(
          SqlCipherRagEmbeddingStorage.forCallerTransaction,
        ).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toBeTruthy();
      } else {
        expect(
          SqlCipherRagEmbeddingStorage.forCallerTransaction,
        ).toHaveBeenCalledTimes(1);
        expect(screen.getByText('기록과 수정 이력을 삭제했어요.')).toBeTruthy();
      }
    } finally {
      AppState.currentState = prior;
      f.close();
    }
  },
);
