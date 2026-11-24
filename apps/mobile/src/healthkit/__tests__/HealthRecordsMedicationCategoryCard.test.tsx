import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { HealthRecordsMedicationCategoryCard } from '../HealthRecordsMedicationCategoryCard';
import { medicationMonthFixture } from './medicationMonthFixture';

const period = {
  fromInclusive: '2026-09-30T03:00:00Z',
  toInclusive: '2026-10-30T03:00:00Z',
  monthlyTakenOnly: true,
};
const original = medicationMonthFixture(period);
const rows = Array.from({ length: 7 }, (_, index) => ({
  medicationId: 'synthetic-' + index,
  name: 'Synthetic ' + (index + 1),
  count: index + 1,
}));
const takenCount = rows.reduce((sum, row) => sum + row.count, 0);
const complete = {
  ...original,
  monthlyTaken: {
    ...period,
    status: 'complete' as const,
    medications: rows,
    takenCount,
    observedCount: takenCount + 4,
    unverifiedCount: 4,
  },
};

test('accessible monthly statistics expand per medication and preserve adaptive Details', async () => {
  const previous = Dimensions.get('window');
  Dimensions.set({ window: { ...previous, fontScale: 1 } });
  const open = jest.fn();
  try {
    const view = await render(
      <HealthRecordsMedicationCategoryCard
        onOpenDetail={open}
        summary={{ data: complete, status: 'ready', reload: jest.fn() }}
      />,
    );
    expect(
      screen.getByTestId('health-record-medications-count'),
    ).toHaveTextContent('복용 확인 28건');
    expect(screen.getByLabelText('Synthetic 1, 복용 확인 1건')).toBeTruthy();
    expect(screen.queryByLabelText('Synthetic 7, 복용 확인 7건')).toBeNull();
    expect(screen.getByText(/확인할 수 없는 기록 4건/u)).toBeTruthy();
    expect(screen.getByTestId('health-record-details-bottom')).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('health-record-medication-month-toggle'),
    );
    expect(screen.getByLabelText('Synthetic 7, 복용 확인 7건')).toBeTruthy();
    await act(async () =>
      fireEvent(
        screen.getByTestId('health-record-category-heading'),
        'layout',
        { nativeEvent: { layout: { width: 700 } } },
      ),
    );
    expect(screen.getByTestId('health-record-details-inline')).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('health-record-open-detail-medications'),
    );
    expect(open).toHaveBeenCalledWith({
      category: 'medications',
      period: 'month',
    });
    await view.unmount();
  } finally {
    Dimensions.set({ window: previous });
  }
});

test('unverified and failed months never show a zero, retained count, or medication name', async () => {
  const view = await render(
    <HealthRecordsMedicationCategoryCard
      onOpenDetail={jest.fn()}
      summary={{
        data: {
          ...complete,
          monthlyTaken: { ...period, status: 'unverified' },
        },
        status: 'ready',
        reload: jest.fn(),
      }}
    />,
  );
  expect(
    screen.getByTestId('health-record-medications-summary'),
  ).toHaveTextContent(/모두 확인할 수 없어/u);
  expect(screen.queryByTestId('health-record-medications-count')).toBeNull();
  const reload = jest.fn();
  await view.rerender(
    <HealthRecordsMedicationCategoryCard
      onOpenDetail={jest.fn()}
      summary={{ data: complete, status: 'failed', reload }}
    />,
  );
  expect(screen.queryByText('Synthetic 1')).toBeNull();
  expect(screen.queryByTestId('health-record-medications-count')).toBeNull();
  await fireEvent.press(screen.getByTestId('health-record-medications-retry'));
  expect(reload).toHaveBeenCalledTimes(1);
});
