import { createManualHistoryRepository } from '@orot/storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { openLocalManualHistoryRepository } from '../../manualHistory/localRepository';
import ManualHistoryEntryDetails from '../../manualHistory/ManualHistoryEntryDetails';
import ManualHistoryForm from '../../manualHistory/ManualHistoryForm';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import { unifySavedMemories } from '../unifiedSavedMemories';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../manualHistory/localRepository', () => ({
  openLocalManualHistoryRepository: jest.fn(),
}));
jest.mock('../../manualHistory/ManualHistoryEntryDetails', () => {
  const Actual = jest.requireActual<
    typeof import('../../manualHistory/ManualHistoryEntryDetails')
  >('../../manualHistory/ManualHistoryEntryDetails').default;
  return { __esModule: true, default: jest.fn(props => <Actual {...props} />) };
});
jest.mock('../../manualHistory/ManualHistoryForm', () => {
  const Actual = jest.requireActual<
    typeof import('../../manualHistory/ManualHistoryForm')
  >('../../manualHistory/ManualHistoryForm').default;
  return { __esModule: true, default: jest.fn(props => <Actual {...props} />) };
});

test.each(['correct', 'delete'] as const)(
  'rejects the queued %s of an original after synchronous Back',
  async action => {
    const f = await healthContextFixture();
    const priorAppState = AppState.currentState;
    AppState.currentState = 'active';
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      const repository = createManualHistoryRepository(f.database);
      const original = await repository.create({
        kind: 'note',
        title: 'Synthetic original history',
        details: 'Unknown-date synthetic details',
        effectiveDate: { status: 'unknown' },
      });
      const deleteOriginal = jest.fn((id: string) => repository.delete(id));
      const guarded = {
        ...repository,
        correct: jest.fn(repository.correct),
        delete: deleteOriginal,
      };
      jest.mocked(openLocalManualHistoryRepository).mockResolvedValue(guarded);
      const load = jest.fn(async () =>
        unifySavedMemories([], await repository.list()),
      );
      let active = true;
      const listeners = new Set<() => void>();
      const ownership = {
        isCurrent: () => active,
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
      view = await render(
        <SavedMemoryDetail
          memoryId={'manual-history:' + original.id}
          ownership={ownership}
          load={load}
        />,
      );
      const control = await screen.findByTestId('manual-history-' + action);
      await fireEvent.press(control);
      // Capture the already-issued application callback, then retire its
      // route in the same React batch before removing the visible controls.
      const queued =
        action === 'correct'
          ? jest.mocked(ManualHistoryForm).mock.calls.at(-1)?.[0]?.onSave
          : jest.mocked(ManualHistoryEntryDetails).mock.calls.at(-1)?.[0]
              ?.onDelete;
      if (!queued) throw new Error('Expected the mounted original action.');
      await act(async () => {
        active = false;
        for (const notify of [...listeners]) notify();
        await queued({
          ...original,
          details: 'Must never replace the original',
          effectiveDate: { status: 'known', date: '2026-10-01' },
        });
      });
      expect(guarded.correct).not.toHaveBeenCalled();
      expect(deleteOriginal).not.toHaveBeenCalled();
      expect(await repository.history(original.id)).toEqual([original]);
      expect(screen.queryByTestId('history-memory-detail')).toBeNull();
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      await view?.unmount();
      AppState.currentState = priorAppState;
      f.close();
    }
  },
);

test('does not open a superseded Settings selection after its lineage changes', async () => {
  const f = await healthContextFixture();
  const priorAppState = AppState.currentState;
  AppState.currentState = 'active';
  let view: Awaited<ReturnType<typeof render>> | undefined;
  try {
    const repository = createManualHistoryRepository(f.database);
    const original = await repository.create({
      kind: 'note',
      title: 'Synthetic selected original',
      details: 'Synthetic uncertain details',
      effectiveDate: { status: 'unknown' },
    });
    const selected = unifySavedMemories([], await repository.list());
    const correction = await repository.correct(original.id, {
      kind: 'note',
      title: 'Synthetic corrected source',
      details: 'Synthetic dated details',
      effectiveDate: { status: 'known', date: '2026-10-01' },
    });
    jest.mocked(openLocalManualHistoryRepository).mockResolvedValue(repository);
    view = await render(
      <SavedMemoryDetail
        memoryId={'manual-history:' + original.id}
        load={async () => selected}
      />,
    );
    expect(screen.queryByTestId('manual-history-delete')).toBeNull();
    expect(screen.queryByTestId('history-memory-body')).toBeNull();
    expect(screen.queryByText(original.title)).toBeNull();
    // If local index cleanup fails, SQLite must retain both original IDs
    // and their exact dates; the stale UI must not publish a deletion.
    const clearIndex = jest.fn(async () => {
      throw new Error('Synthetic index rollback');
    });
    await expect(
      f.database.transaction(async tx => {
        await repository.delete(correction.id, tx, clearIndex);
      }),
    ).rejects.toThrow('Synthetic index rollback');
    expect(clearIndex).toHaveBeenCalledWith([original.id, correction.id]);
    expect(await repository.history(original.id)).toEqual([
      original,
      correction,
    ]);
    expect(await repository.list()).toEqual([correction]);
  } finally {
    await view?.unmount();
    AppState.currentState = priorAppState;
    f.close();
  }
});
