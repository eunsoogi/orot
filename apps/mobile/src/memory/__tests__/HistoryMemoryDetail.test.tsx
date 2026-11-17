import { AppState } from 'react-native';
import { SavedMemoryDetail } from '../SavedMemoryDetail';
import { unifySavedMemories } from '../unifiedSavedMemories';
import { openLocalManualHistoryRepository } from '../../manualHistory/localRepository';
jest.mock('../../manualHistory/localRepository', () => ({
  openLocalManualHistoryRepository: jest.fn(),
}));
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import ManualHistoryEntryDetails from '../../manualHistory/ManualHistoryEntryDetails';
import { HistoryMemoryDetail } from '../HistoryMemoryDetail';
import type { ManualHistoryScreenRecord } from '../../manualHistory/types';
const record: ManualHistoryScreenRecord = {
  id: 'synthetic-original',
  kind: 'note',
  title: '합성 기억',
  details: '직접 말한 내용',
  effectiveDate: { status: 'unknown' },
  recordedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'user_reported' },
  reviewState: { status: 'unreviewed' },
};
jest.mock('../../manualHistory/ManualHistoryEntryDetails', () => {
  const Actual = jest.requireActual(
    '../../manualHistory/ManualHistoryEntryDetails',
  ).default;
  return { __esModule: true, default: jest.fn(props => <Actual {...props} />) };
});

jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
function setup() {
  const repository = {
    list: jest.fn(),
    create: jest.fn(),
    correct: jest.fn().mockResolvedValue({ ...record, id: 'corrected' }),
    delete: jest.fn().mockResolvedValue(true),
    history: jest.fn().mockResolvedValue([record]),
  };
  const onChanged = jest.fn();
  return {
    repository,
    onChanged,
    openRepository: jest.fn().mockResolvedValue(repository),
  };
}
it('shows the original uncertainty and correction history without any create action', async () => {
  const props = setup();
  await render(<HistoryMemoryDetail record={record} {...props} />);
  expect(
    screen.getByText('직접 입력한 기록이며 의료진이 확인한 정보가 아니에요.'),
  ).toBeTruthy();
  expect(screen.getAllByText('기준일을 모름').length).toBeGreaterThan(0);
  expect(screen.queryByTestId('manual-history-add')).toBeNull();
  expect(props.repository.create).not.toHaveBeenCalled();
});
it('requires explicit confirmation and supports cancelling deletion', async () => {
  const props = setup();
  await render(<HistoryMemoryDetail record={record} {...props} />);
  await fireEvent.press(screen.getByTestId('manual-history-delete'));
  expect(props.repository.delete).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('manual-history-cancel-delete'));
  expect(props.repository.delete).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('manual-history-delete'));
  await fireEvent.press(screen.getByTestId('manual-history-confirm-delete'));
  expect(props.repository.delete).toHaveBeenCalledWith(record.id);
  expect(props.onChanged).toHaveBeenCalledWith('manual-history:' + record.id);
});
it('corrects the existing original without creating and retains unknown date', async () => {
  const props = setup();
  await render(<HistoryMemoryDetail record={record} {...props} />);
  await fireEvent.press(screen.getByTestId('manual-history-correct'));
  await fireEvent.changeText(
    screen.getByTestId('manual-history-details-input'),
    '합성 수정',
  );
  await fireEvent.press(screen.getByTestId('manual-history-save'));
  expect(props.repository.correct).toHaveBeenCalledWith(
    record.id,
    expect.objectContaining({
      details: '합성 수정',
      effectiveDate: { status: 'unknown' },
    }),
  );
  expect(props.repository.create).not.toHaveBeenCalled();
  expect(props.onChanged).toHaveBeenCalledWith('manual-history:corrected');
});
it('does not navigate or republish after a late mutation settles after unmount', async () => {
  const props = setup();
  let finish!: () => void;
  props.repository.delete.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = () => resolve(true);
      }),
  );
  const view = await render(<HistoryMemoryDetail record={record} {...props} />);
  await fireEvent.press(screen.getByTestId('manual-history-delete'));
  await act(async () => {
    jest.mocked(ManualHistoryEntryDetails).mock.calls.at(-1)![0].onDelete();
  });
  await view.unmount();
  await act(async () => finish());
  expect(props.onChanged).not.toHaveBeenCalled();
});

it('erases an actual memory destination on background while deletion is pending', async () => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
  const props = setup();
  jest
    .mocked(openLocalManualHistoryRepository)
    .mockResolvedValue(props.repository);
  let finish!: () => void;
  props.repository.delete.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = () => resolve(true);
      }),
  );
  const load = jest.fn(async () => unifySavedMemories([], [record]));
  await render(
    <SavedMemoryDetail memoryId={'manual-history:' + record.id} load={load} />,
  );
  await screen.findByTestId('manual-history-delete');
  await act(async () => {
    jest.mocked(ManualHistoryEntryDetails).mock.calls.at(-1)![0].onDelete();
  });
  await act(async () => {
    jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1]('background');
  });
  expect(screen.queryByTestId('history-memory-detail')).toBeNull();
  await act(async () => finish());
  expect(screen.queryByTestId('history-memory-detail')).toBeNull();
  expect(load).toHaveBeenCalledTimes(1);
});
