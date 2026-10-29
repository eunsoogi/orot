import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { SymptomEntrySchema } from '@orot/storage';
import SymptomsScreen from './SymptomsScreen';
import { toLocalSymptomDateTime } from './dateTime';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const recordedAt = '2026-05-01T12:00:00Z';
const entry = SymptomEntrySchema.parse({
  id: 'synthetic-inline-entry',
  effectiveAt: recordedAt,
  recordedAt,
  ingestedAt: recordedAt,
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  description: '합성 두통',
  bodySite: '머리',
  severity: 0,
  status: 'active',
});
async function open(
  overrides: Partial<React.ComponentProps<typeof SymptomsScreen>> = {},
) {
  await render(
    <SymptomsScreen
      entries={[entry]}
      onBack={jest.fn()}
      onRetry={jest.fn()}
      onFilterChange={jest.fn()}
      onCreate={jest.fn()}
      onUpdate={jest.fn()}
      onResolve={jest.fn()}
      {...overrides}
    />,
  );
}

test('new entry shows only its form with a stable current local onset and no saved severity default', async () => {
  await open();
  const before = toLocalSymptomDateTime(new Date().toISOString());
  await fireEvent.press(screen.getByTestId('symptom-add'));
  await fireEvent.press(screen.getByTestId('symptom-onset-manual'));
  expect(screen.queryByTestId('symptom-filter-active')).toBeNull();
  expect(screen.queryByTestId('symptoms-selection-empty')).toBeNull();
  expect(screen.queryByTestId(`symptom-${entry.id}`)).toBeNull();
  expect(screen.getByTestId('symptom-onset-date')).toHaveProp(
    'value',
    before.date,
  );
  expect(screen.getByTestId('symptom-onset-time')).toHaveProp(
    'value',
    before.time,
  );
  expect(screen.getByTestId('symptom-severity')).toHaveProp('value', '');
});

test('only the selected card expands inline and toggles closed', async () => {
  await open();
  expect(screen.queryByTestId(`symptom-edit-${entry.id}`)).toBeNull();
  expect(screen.queryByTestId('symptoms-selection-empty')).toBeNull();
  await fireEvent.press(screen.getByTestId(`symptom-select-${entry.id}`));
  expect(
    within(screen.getByTestId(`symptom-${entry.id}`)).getByTestId(
      'symptoms-selected-summary',
    ),
  ).toBeTruthy();
  expect(screen.getByTestId(`symptom-edit-${entry.id}`)).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`symptom-select-${entry.id}`));
  expect(screen.queryByTestId(`symptom-edit-${entry.id}`)).toBeNull();
});

test.each(['create', 'edit'] as const)(
  'unapplied period draft survives %s and return',
  async mode => {
    const onFilterChange = jest.fn();
    await open({ onFilterChange });
    await fireEvent.press(screen.getByTestId('symptom-filter-period'));
    await fireEvent.changeText(
      screen.getByTestId('symptom-filter-from-date'),
      '2025-01-02',
    );
    await fireEvent.changeText(
      screen.getByTestId('symptom-filter-from-time'),
      '09:30',
    );
    if (mode === 'create')
      await fireEvent.press(screen.getByTestId('symptom-add'));
    else {
      await fireEvent.press(screen.getByTestId(`symptom-select-${entry.id}`));
      await fireEvent.press(screen.getByTestId(`symptom-edit-${entry.id}`));
    }
    await fireEvent.press(screen.getByTestId('symptom-form-cancel'));
    expect(screen.getByTestId('symptom-filter-from-date')).toHaveProp(
      'value',
      '2025-01-02',
    );
    expect(screen.getByTestId('symptom-filter-from-time')).toHaveProp(
      'value',
      '09:30',
    );
    expect(onFilterChange).not.toHaveBeenCalled();
  },
);

test('edit opens its populated form directly with immutable onset and status context', async () => {
  await open();
  await fireEvent.press(screen.getByTestId(`symptom-select-${entry.id}`));
  await fireEvent.press(screen.getByTestId(`symptom-edit-${entry.id}`));
  expect(screen.getByText('증상 수정')).toBeTruthy();
  expect(screen.getByTestId('symptom-description')).toHaveProp(
    'value',
    entry.description,
  );
  expect(screen.getByTestId('symptom-body-site')).toHaveProp('value', '머리');
  expect(screen.getByTestId('symptom-severity')).toHaveProp('value', '0');
  expect(screen.getByTestId('symptom-edit-context')).toHaveTextContent(
    /계속되고 있어요/,
  );
  expect(screen.queryByTestId('symptom-filter-active')).toBeNull();
});

test('failed resolution retains the selected active card and offers the same operation as retry', async () => {
  const onResolve = jest
    .fn()
    .mockRejectedValueOnce(new Error('synthetic resolution failure'))
    .mockResolvedValueOnce(undefined);
  await open({ onResolve });
  await fireEvent.press(screen.getByTestId(`symptom-select-${entry.id}`));
  await fireEvent.press(screen.getByTestId(`symptom-resolve-${entry.id}`));
  expect(await screen.findByTestId('symptoms-error')).toHaveTextContent(
    /변경하지 못했어요/,
  );
  expect(screen.getByTestId(`symptom-${entry.id}-status`)).toHaveTextContent(
    '계속되고 있어요',
  );
  expect(screen.getByTestId(`symptom-resolve-${entry.id}`)).toHaveTextContent(
    '다시 시도',
  );
  await fireEvent.press(screen.getByTestId(`symptom-resolve-${entry.id}`));
  await waitFor(() => expect(onResolve).toHaveBeenCalledTimes(2));
  expect(onResolve.mock.calls).toEqual([[entry.id], [entry.id]]);
  expect(screen.queryByTestId('symptoms-error')).toBeNull();
});
