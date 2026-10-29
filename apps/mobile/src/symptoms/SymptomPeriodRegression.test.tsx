import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createSymptomRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../healthEvidence/localEvidenceTestSupport';
import { createSymptomJournalRepository } from './localRepository';
import { toLocalSymptomDateTime } from './dateTime';
import SymptomsScreen from './SymptomsScreen';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('a stored instant within the displayed ending minute is returned by the period filter', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  await runMigrations(database);
  const journal = createSymptomJournalRepository(
    createSymptomRepository(database),
    {
      now: () => '2026-05-01T12:00:00.000Z',
      createId: () => 'minute-boundary',
    },
  );
  const instant = '2026-04-20T08:30:43.456Z';
  const local = toLocalSymptomDateTime(instant);
  let results: Awaited<ReturnType<typeof journal.list>> = [];
  await render(
    <SymptomsScreen
      entries={[]}
      onBack={jest.fn()}
      onRetry={jest.fn()}
      onCreate={async draft => {
        await journal.create(draft);
      }}
      onUpdate={jest.fn()}
      onResolve={jest.fn()}
      onFilterChange={async filter => {
        results = await journal.list(filter);
      }}
    />,
  );
  await fireEvent.press(screen.getByTestId('symptom-add'));
  await fireEvent.changeText(
    screen.getByTestId('symptom-description'),
    '합성 증상',
  );
  await fireEvent.press(screen.getByTestId('symptom-status-active'));
  await fireEvent.press(screen.getByTestId('symptom-onset-choose-date'));
  await fireEvent(screen.getByTestId('symptom-onset-picker'), 'change', {
    nativeEvent: { timestamp: new Date(instant).getTime(), utcOffset: 0 },
  });
  await fireEvent.press(screen.getByTestId('symptom-onset-picker-done'));
  await fireEvent.press(screen.getByTestId('symptom-save'));
  await waitFor(() =>
    expect(screen.getByTestId('symptom-filter-period')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('symptom-filter-period'));
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-through-date'),
    local.date,
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-through-time'),
    local.time,
  );
  await fireEvent.press(screen.getByTestId('symptom-filter-apply'));
  await waitFor(() =>
    expect(results.map(item => item.effectiveAt)).toEqual([instant]),
  );
  close();
});

test('repeated local minutes exclude intervening wall times and support dates across the fold', async () => {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'America/New_York')
    return;
  const { database, close } = createHealthEvidenceTestDatabase();
  await runMigrations(database);
  let sequence = 0;
  const journal = createSymptomJournalRepository(
    createSymptomRepository(database),
    {
      now: () => '2025-11-03T12:00:00.000Z',
      createId: () => `fold-${sequence++}`,
    },
  );
  const instants = [
    '2025-11-02T05:29:00.000Z',
    '2025-11-02T05:30:43.000Z',
    '2025-11-02T05:31:00.000Z',
    '2025-11-02T05:45:00.000Z',
    '2025-11-02T06:29:00.000Z',
    '2025-11-02T06:30:43.000Z',
    '2025-11-02T06:31:00.000Z',
    '2025-11-02T06:45:00.000Z',
  ];
  for (const onsetAt of instants)
    await journal.create({
      onsetAt,
      description: '합성 증상',
      status: 'active',
    });
  let results: string[] = [];
  await render(
    <SymptomsScreen
      entries={[]}
      onBack={jest.fn()}
      onRetry={jest.fn()}
      onCreate={jest.fn()}
      onUpdate={jest.fn()}
      onResolve={jest.fn()}
      onFilterChange={async filter => {
        results = (await journal.list(filter)).map(item => item.effectiveAt);
      }}
    />,
  );
  await fireEvent.press(screen.getByTestId('symptom-filter-period'));
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-from-date'),
    '2025-11-02',
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-from-time'),
    '01:30',
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-through-date'),
    '2025-11-02',
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-through-time'),
    '01:30',
  );
  await fireEvent.press(screen.getByTestId('symptom-filter-apply'));
  await waitFor(() =>
    expect(results).toEqual([
      '2025-11-02T06:30:43.000Z',
      '2025-11-02T05:30:43.000Z',
    ]),
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-from-date'),
    '2025-11-01',
  );
  await fireEvent.press(screen.getByTestId('symptom-filter-apply'));
  await waitFor(() =>
    expect(results).toEqual([
      '2025-11-02T06:30:43.000Z',
      '2025-11-02T06:29:00.000Z',
      '2025-11-02T05:30:43.000Z',
      '2025-11-02T05:29:00.000Z',
    ]),
  );
  close();
});
