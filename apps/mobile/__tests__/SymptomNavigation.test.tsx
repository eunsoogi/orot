import { fireEvent, render, screen } from '@testing-library/react-native';
import App from '../App';
import { SymptomEntrySchema } from '@orot/storage';
import { createAppointmentStore } from '../test-helpers/appointmentStore';
import {
  activeHomeSymptom,
  homeJournal,
} from '../test-helpers/homeOverviewFixtures';
import type { SymptomJournalRepository } from '../src/symptoms/localRepository';

jest.mock('../src/healthkit/autoSyncLocal', () => ({
  syncLocalPreviouslyRequestedHealthKit: jest.fn(async () => ({
    status: 'skipped',
  })),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('opens the encrypted journal through Records and retains its query after returning', async () => {
  const entry = SymptomEntrySchema.parse({
    id: 'synthetic-journal-entry',
    effectiveAt: '2026-04-20T08:30:00Z',
    recordedAt: '2026-05-01T12:00:00Z',
    ingestedAt: '2026-05-01T12:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: 'Synthetic hand tingling',
    status: 'active',
  });
  const journal: SymptomJournalRepository = {
    list: jest.fn(async () => [entry]),
    create: jest.fn(async () => entry),
    update: jest.fn(async () => entry),
    resolve: jest.fn(async () => entry),
  };
  const loadSymptoms = jest.fn(async () => journal);
  const store = createAppointmentStore();
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
      loadSymptoms={loadSymptoms}
    />,
  );
  // Home reads the active summary; entering the journal still loads its own retained query.
  expect(loadSymptoms).toHaveBeenCalledTimes(1);
  expect(journal.list).toHaveBeenCalledWith({ status: 'active' });
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  await fireEvent.press(screen.getByTestId('symptoms-open'));
  expect(
    await screen.findByTestId('symptom-synthetic-journal-entry-description'),
  ).toHaveTextContent(entry.description);
  expect(screen.queryByTestId('symptoms-back')).toBeNull();
  await fireEvent.press(screen.getByTestId('symptom-filter-active'));
  expect(journal.list).toHaveBeenLastCalledWith({ status: 'active' });
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByTestId('records-title')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('symptoms-open'));
  expect(
    (await screen.findByTestId('symptom-filter-active')).props
      .accessibilityState,
  ).toEqual(expect.objectContaining({ selected: true }));
  expect(journal.list).toHaveBeenLastCalledWith({ status: 'active' });
});

test('opens the active symptom from Home, returns, and preserves root navigation', async () => {
  const store = createAppointmentStore();
  const journal = homeJournal();
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
      loadSymptoms={async () => journal}
    />,
  );
  expect(await screen.findByText(/합성 손 저림/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('home-open-symptoms'));
  expect(await screen.findByTestId('symptoms-layout')).toBeTruthy();
  expect(
    await screen.findByTestId(`symptom-${activeHomeSymptom.id}-description`),
  ).toHaveTextContent(activeHomeSymptom.description);
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByTestId('welcome-title')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-tab-records'));
  expect(await screen.findByTestId('records-title')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-tab-home'));
  expect(await screen.findByTestId('welcome-title')).toBeTruthy();
  expect(
    screen.getByTestId('navigation-tab-home').props.accessibilityState,
  ).toEqual(expect.objectContaining({ selected: true }));
});
