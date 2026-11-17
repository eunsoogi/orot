import { fireEvent, render, screen } from '@testing-library/react-native';
import { SavedSummaryHistory } from '../SavedSummaryHistory';
import { SummaryHistoryScreen } from '../SummaryHistoryScreen';

const row = {
  id: 'legacy',
  createdAt: '2035-01-01T00:00:00Z',
  modelName: 'Synthetic',
};
const unavailable = {
  status: 'unavailable' as const,
  reason: 'legacy_period_unverified' as const,
};

test('keeps only quarantined history metadata and opens the existing regeneration route without reading text', async () => {
  const history = {
    list: jest.fn(async () => [
      { ...row, unavailableReason: unavailable.reason },
    ]),
    read: jest.fn(async () => ({
      hypotheses: [],
      privateText: 'SECRET_SAVED_TEXT',
    })),
    readStatus: jest.fn(async () => unavailable),
  };
  const regenerate = jest.fn();
  const restore = jest.fn();
  await render(
    <SummaryHistoryScreen
      history={history}
      onRestore={restore}
      onRegenerate={regenerate}
    />,
  );
  expect(
    await screen.findByText(/원본 기록 삭제 이력을 확인할 수 없어/),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: /Synthetic/ })).toBeDisabled();
  await fireEvent.press(
    screen.getByRole('button', { name: '현재 기록으로 새 요약 만들기' }),
  );
  expect(regenerate).toHaveBeenCalledTimes(1);
  expect(history.read).not.toHaveBeenCalled();
  expect(history.readStatus).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  expect(screen.queryByText('SECRET_SAVED_TEXT')).toBeNull();
});

test('a newly quarantined read returns only its reason, never calls restore or falls back to raw read', async () => {
  const history = {
    list: async () => [row],
    read: jest.fn(async () => null),
    readStatus: jest.fn(async () => unavailable),
  };
  const restore = jest.fn();
  await render(
    <SavedSummaryHistory
      history={history}
      expanded
      disabled={false}
      onRestore={restore}
      onRegenerate={jest.fn()}
    />,
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: /Synthetic/ }),
  );
  expect(await screen.findByTestId('summary-period-unavailable')).toBeTruthy();
  expect(history.readStatus).toHaveBeenCalledWith(row.id);
  expect(history.read).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  expect(screen.queryByText('저장된 요약을 불러오지 못했어요.')).toBeNull();
});

test('current summaries and ordinary sourceChanged results keep their original restore contract', async () => {
  const analysis = {
    hypotheses: [],
    savedSummary: {
      status: 'saved' as const,
      id: 'current',
      createdAt: row.createdAt,
      modelName: row.modelName,
      sourceChanged: true,
    },
  };
  const history = {
    list: async () => [row],
    read: jest.fn(async () => analysis),
    readStatus: jest.fn(async () => ({ analysis })),
  };
  const restore = jest.fn();
  await render(
    <SavedSummaryHistory
      history={history}
      expanded
      disabled={false}
      onRestore={restore}
    />,
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: /Synthetic/ }),
  );
  expect(restore).toHaveBeenCalledWith(analysis);
  expect(screen.queryByTestId('summary-period-unavailable')).toBeNull();
});
