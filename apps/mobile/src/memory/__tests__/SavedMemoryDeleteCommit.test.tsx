import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import type { ManualHistoryScreenRecord } from '../../manualHistory/types';
import { openLocalManualHistoryRepository } from '../../manualHistory/localRepository';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import { unifySavedMemories } from '../unifiedSavedMemories';

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../manualHistory/localRepository', () => ({
  openLocalManualHistoryRepository: jest.fn(),
}));

const savedNote: ManualHistoryScreenRecord = {
  id: 'conversation-local-memory:synthetic-note',
  kind: 'note',
  title: 'Synthetic saved note',
  details: 'Synthetic saved note text',
  effectiveDate: { status: 'unknown' },
  recordedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'user_reported' },
  reviewState: { status: 'unreviewed' },
};
const untouchedNote = {
  ...savedNote,
  id: 'conversation-local-memory:unrelated',
  title: 'Synthetic untouched note',
  details: 'Synthetic untouched note text',
};
const selectedMemoryId = 'manual-history:' + savedNote.id;

function setup() {
  const repository = {
    list: jest.fn(),
    create: jest.fn(),
    history: jest.fn().mockResolvedValue([savedNote]),
    correct: jest.fn(),
    delete: jest.fn(),
  };
  jest.mocked(openLocalManualHistoryRepository).mockResolvedValue(repository);
  return repository;
}

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});

test('committed detail deletion never reloads the whole Memory library before showing success', async () => {
  const repository = setup();
  let commit!: () => void;
  repository.delete.mockImplementation(
    () => new Promise<boolean>(resolve => (commit = () => resolve(true))),
  );
  const loadDetail = jest
    .fn()
    .mockResolvedValueOnce(unifySavedMemories([], [savedNote, untouchedNote]))
    .mockImplementation(() => new Promise(() => {}));
  const loadList = jest
    .fn()
    .mockResolvedValue(unifySavedMemories([], [untouchedNote]));
  const view = await render(
    <>
      <SavedMemoryBrowser active={false} load={loadList} />
      <SavedMemoryDetail memoryId={selectedMemoryId} load={loadDetail} />
    </>,
  );
  await fireEvent.press(await screen.findByTestId('manual-history-delete'));
  expect(repository.delete).not.toHaveBeenCalled();
  // Start the real confirmation handler, but hold the simulated commit.
  await fireEvent.press(screen.getByTestId('manual-history-confirm-delete'));
  expect(repository.delete).toHaveBeenCalledWith(savedNote.id);
  expect(screen.queryByText('기록과 수정 이력을 삭제했어요.')).toBeNull();
  expect(screen.getByText(savedNote.details)).toBeTruthy();

  await act(async () => commit());
  expect(screen.getByText('기록과 수정 이력을 삭제했어요.')).toBeTruthy();
  expect(screen.queryByText(savedNote.details)).toBeNull();
  expect(loadDetail).toHaveBeenCalledTimes(1);
  expect(loadList).not.toHaveBeenCalled();

  await view.rerender(
    <>
      <SavedMemoryBrowser load={loadList} />
      <SavedMemoryDetail
        active={false}
        memoryId={selectedMemoryId}
        load={loadDetail}
      />
    </>,
  );
  expect(loadList).toHaveBeenCalledTimes(1);
  expect(
    screen.getByTestId('saved-memory-entry-manual-history:' + untouchedNote.id),
  ).toBeTruthy();
  expect(
    screen.queryByTestId('saved-memory-entry-' + selectedMemoryId),
  ).toBeNull();
});

test('a rejected deletion retains the existing detail and never reports success', async () => {
  const repository = setup();
  repository.delete.mockRejectedValueOnce(new Error('Synthetic SQL rollback'));
  const loadDetail = jest
    .fn()
    .mockResolvedValue(unifySavedMemories([], [savedNote]));
  await render(
    <SavedMemoryDetail memoryId={selectedMemoryId} load={loadDetail} />,
  );
  await fireEvent.press(await screen.findByTestId('manual-history-delete'));
  await fireEvent.press(screen.getByTestId('manual-history-confirm-delete'));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText(savedNote.details)).toBeTruthy();
  expect(screen.queryByText('기록과 수정 이력을 삭제했어요.')).toBeNull();
  expect(loadDetail).toHaveBeenCalledTimes(1);
});
