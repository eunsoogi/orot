import { fireEvent, render, screen } from '@testing-library/react-native';
import { SymptomEntrySchema } from '@orot/storage';
import type { SymptomEntry } from '@orot/storage';
import App from '../App';
import type { SymptomJournalRepository } from '../src/symptoms/localRepository';

function symptom(id: string, status: 'active' | 'resolved' = 'active') {
  return SymptomEntrySchema.parse({
    id,
    effectiveAt: '2026-04-20T08:30:00Z',
    recordedAt: '2026-05-01T12:00:00Z',
    ingestedAt: '2026-05-01T12:00:01Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: `Synthetic symptom ${id}`,
    status,
    ...(status === 'resolved' ? { resolvedAt: '2026-05-01T13:00:00Z' } : {}),
  });
}

function repository(
  list: SymptomJournalRepository['list'],
  entry: SymptomEntry,
): SymptomJournalRepository {
  return {
    list,
    create: jest.fn(async () => entry),
    update: jest.fn(async () => null),
    resolve: jest.fn(async () => null),
  };
}

it('shows an initial list error and lets the user retry successfully', async () => {
  const entry = symptom('initial-retry');
  const list = jest.fn(async () => [entry]);
  list.mockRejectedValueOnce(new Error('Database unavailable.'));
  const journal = repository(list, entry);
  await render(<App loadSymptoms={async () => journal} />);

  await fireEvent.press(screen.getByTestId('symptoms-open'));

  expect(await screen.findByTestId('symptoms-load-error')).toHaveTextContent(
    'Symptoms could not be loaded. Try again.',
  );
  await fireEvent.press(screen.getByTestId('symptoms-retry-list'));
  expect(await screen.findByTestId('symptom-initial-retry-description')).toHaveTextContent(
    entry.description,
  );
});

it('hides stale results after a filtered list error and retries the selected filter', async () => {
  const active = symptom('stale-active');
  const resolved = symptom('recovered-resolved', 'resolved');
  const list = jest.fn()
    .mockResolvedValueOnce([active])
    .mockRejectedValueOnce(new Error('Database unavailable.'))
    .mockResolvedValueOnce([resolved]);
  const journal = repository(list, active);
  await render(<App loadSymptoms={async () => journal} />);

  await fireEvent.press(screen.getByTestId('symptoms-open'));
  expect(await screen.findByTestId('symptom-stale-active-status')).toHaveTextContent('Active');
  await fireEvent.press(screen.getByTestId('symptom-filter-resolved'));

  expect(await screen.findByTestId('symptoms-load-error')).toHaveTextContent(
    'Symptoms could not be loaded. Try again.',
  );
  expect(screen.queryByTestId('symptom-stale-active')).toBeNull();
  await fireEvent.press(screen.getByTestId('symptoms-retry-list'));

  expect(await screen.findByTestId('symptom-recovered-resolved-status')).toHaveTextContent(
    'Resolved',
  );
  expect(list).toHaveBeenNthCalledWith(2, { status: 'resolved' });
  expect(list).toHaveBeenNthCalledWith(3, { status: 'resolved' });
});
