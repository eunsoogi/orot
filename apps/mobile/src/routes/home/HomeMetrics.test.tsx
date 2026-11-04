import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { HomeMetrics } from './HomeMetrics';
import { useHomeMetrics } from './useHomeMetrics';
import type { HomeMetric } from './metricSelection';

jest.mock('./useHomeMetrics');
const mocked = jest.mocked(useHomeMetrics);

test.each([
  ['sleep', '해당 날짜 기록 합계', 'min'],
  ['heartRate', '해당 날짜 측정 평균', 'count/min'],
  ['bodyMass', '해당 날짜 마지막 측정', 'kg'],
  ['steps', '해당 날짜 기록 합계', 'count'],
] as const)(
  'announces the %s statistic, unit and source in its accessible summary',
  async (metric: HomeMetric, statistic, unit) => {
    mocked.mockReturnValue({
      selection: [metric, metric === 'sleep' ? 'heartRate' : 'sleep'],
      metrics: {
        [metric]: {
          metric,
          unit,
          source: 'Watch',
          measuredAt: '2026-10-14T10:00:00Z',
          timeZone: 'UTC',
          latest: { date: '2026-10-14', value: 70 },
          days: [],
          comparison: null,
        },
      },
      quantityTruncated: false,
      state: 'ready',
      retry: jest.fn(),
      save: jest.fn(),
    });
    await render(<HomeMetrics />);
    const summary = screen.getByTestId(`home-metric-${metric}`);
    expect(summary.props.accessibilityLabel).toContain(statistic);
    expect(summary.props.accessibilityLabel).toContain(`70 ${unit}.`);
    expect(summary.props.accessibilityLabel).toContain('Watch');
  },
);

test('shows accessible gaps and keeps a failed selection save open for retry', async () => {
  const save = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValueOnce(undefined);
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {
      heartRate: {
        metric: 'heartRate',
        unit: 'count/min',
        source: 'Watch',
        measuredAt: '2026-10-14T10:00:00Z',
        timeZone: 'UTC',
        latest: { date: '2026-10-14', value: 70 },
        days: [
          { date: '2026-10-14', value: 70, partial: false },
          { date: '2026-10-15', value: null, partial: true },
        ],
        comparison: null,
      },
    },
    state: 'ready',
    quantityTruncated: false,
    retry: jest.fn(),
    save,
  });
  await render(<HomeMetrics />);
  expect(screen.getByLabelText(/2026-10-15: 기록이 없어요/)).toBeTruthy();
  expect(screen.getByLabelText(/해당 날짜 측정 평균/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: /체중/ }));
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  expect(await screen.findByText('선택을 저장하지 못했어요.')).toBeTruthy();
  expect(save).toHaveBeenCalledWith(['sleep', 'heartRate', 'bodyMass']);
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
  expect(save).toHaveBeenCalledTimes(2);
});

test('cancel discards the draft and keeps the saved selection when editing again', async () => {
  const save = jest.fn();
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save,
  });
  await render(<HomeMetrics />);
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: /체중/ }));
  await fireEvent.press(screen.getByRole('button', { name: '취소' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  expect(
    screen.getByRole('checkbox', { name: /체중/ }).props.accessibilityState
      .checked,
  ).toBe(false);
  expect(
    screen.getByRole('checkbox', { name: /기록된 수면/ }).props
      .accessibilityState.checked,
  ).toBe(true);
});

test('prevents changing or cancelling a draft while its save is pending', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => {
    finish = resolve;
  });
  const save = jest.fn(() => pending);
  mocked.mockReturnValue({
    selection: ['sleep', 'heartRate'],
    metrics: {},
    quantityTruncated: false,
    state: 'ready',
    retry: jest.fn(),
    save,
  });
  await render(<HomeMetrics />);
  expect(screen.getAllByText('최근 14일과 오늘에 기록이 없어요.')).toHaveLength(
    2,
  );
  await fireEvent.press(screen.getByRole('button', { name: '편집' }));
  const press = fireEvent.press(screen.getByRole('button', { name: '저장' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '취소' })).toBeDisabled(),
  );
  expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: /체중/ })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: '저장' }));
  expect(save).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  await press;
  expect(screen.queryByRole('button', { name: '취소' })).toBeNull();
});
