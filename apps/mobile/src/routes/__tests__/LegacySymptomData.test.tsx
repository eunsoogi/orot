import { chunkStructuredRecord } from '@orot/rag';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { createSymptomSummaryStorage } from '../../storage/symptomSummaryStorage';
import { createLocalE5RagService } from '../../rag/localE5RagService';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createVersionTwo } from '../../../../../packages/storage/__tests__/historicalMigrationSupport';
import {
  LegacySymptomData,
  createLegacySymptomStore,
} from '../LegacySymptomData';
import {
  pendingSymptomDeletions,
  removeLegacySymptom,
} from '../legacySymptomDeletion';

jest.mock('../../storage/secureDatabase', () => ({}));

const entry = {
  id: 'legacy-symptom',
  description: 'Synthetic old symptom',
  status: 'active' as const,
  effectiveAt: '2026-10-01T12:00:00Z',
  recordedAt: '2026-10-01T12:00:00Z',
  ingestedAt: '2026-10-01T12:00:00Z',
  provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' as const },
};

test('legacy source remains readable and confirmed deletion invalidates linked saved summary', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    await repository.put('symptom_entry', entry);
    await repository.put(
      'health_observation',
      healthObservation(entry.id, 'heart_rate', entry.effectiveAt),
    );
    const summaries = createSymptomSummaryStorage(database);
    await summaries.list(); // Set up the same persistent deletion triggers as a saved summary.
    await database.execute(
      'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
      ['saved', entry.recordedAt, 'Synthetic', '{}'],
    );
    await database.execute(
      'INSERT INTO symptom_summary_sources (summary_id, record_kind, record_id) VALUES (?, ?, ?)',
      ['saved', 'symptom_entry', entry.id],
    );
    await database.execute(
      'INSERT INTO symptom_summary_runs (id, created_at, model_name, result_json) VALUES (?, ?, ?, ?)',
      ['other', entry.recordedAt, 'Synthetic', '{}'],
    );
    await database.execute(
      'INSERT INTO symptom_summary_sources (summary_id, record_kind, record_id) VALUES (?, ?, ?)',
      ['other', 'health_observation', entry.id],
    );
    const rag = createLocalE5RagService(database);
    await rag.prepare();
    const openStore = async () =>
      createLegacySymptomStore(repository, id =>
        removeLegacySymptom(repository, rag, id),
      );
    const view = await render(<LegacySymptomData openStore={openStore} />);
    await fireEvent.press(await screen.findByTestId('legacy-symptom-toggle'));
    expect(screen.getByText(entry.description)).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', {
        name: `이전 증상 데이터 삭제: ${entry.description}`,
      }),
    );
    expect(await repository.get('symptom_entry', entry.id)).not.toBeNull();
    const buttons = alert.mock.calls[0]?.[2];
    expect(buttons?.[0]?.style).toBe('cancel');
    await act(async () => {
      buttons?.[1]?.onPress?.();
    });
    await waitFor(async () =>
      expect(await repository.get('symptom_entry', entry.id)).toBeNull(),
    );
    expect(
      (
        await database.execute(
          'SELECT id FROM symptom_summary_runs WHERE id = ?',
          ['saved'],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await database.execute(
          'SELECT id FROM symptom_summary_runs WHERE id = ?',
          ['other'],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await database.execute(
          'SELECT chunk_id FROM rag_embedding_removed_chunks WHERE chunk_id = ?',
          [chunkStructuredRecord('symptom_entry', entry).id],
        )
      ).rows,
    ).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByTestId('legacy-symptom-data')).toBeNull(),
    );
    await view.unmount();
  } finally {
    alert.mockRestore();
    close();
  }
});

test('keeps another record with the same ID when deleting the symptom', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    await repository.put('symptom_entry', entry);
    await repository.put(
      'health_observation',
      healthObservation(entry.id, 'heart_rate', entry.effectiveAt),
    );
    const rag = createLocalE5RagService(database);
    await rag.prepare();
    await expect(removeLegacySymptom(repository, rag, entry.id)).resolves.toBe(
      true,
    );
    expect(await repository.get('symptom_entry', entry.id)).toBeNull();
    expect(await repository.get('health_observation', entry.id)).not.toBeNull();
  } finally {
    close();
  }
});

test('opens symptom data created before current database migrations without altering it', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await createVersionTwo(database);
    const preStatusEntry: Record<string, unknown> = { ...entry };
    delete preStatusEntry.status;
    await database.execute(
      'INSERT INTO symptom_entries (id, effective_at, recorded_at, ingested_at, payload_json) VALUES (?, ?, ?, ?, ?)',
      [
        entry.id,
        entry.effectiveAt,
        entry.recordedAt,
        entry.ingestedAt,
        JSON.stringify(preStatusEntry),
      ],
    );
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const store = createLegacySymptomStore(repository, id =>
      repository.delete('symptom_entry', id),
    );
    expect(await store.list()).toEqual([entry]);
  } finally {
    close();
  }
});

test('shows an unfinished deletion after reopening the data screen', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    await records.put('symptom_entry', entry);
    await pendingSymptomDeletions(records);
    await database.execute(
      'INSERT INTO legacy_symptom_deletion_pending (id) VALUES (?)',
      [entry.id],
    );
    const view = await render(
      <LegacySymptomData
        openStore={async () =>
          createLegacySymptomStore(records, id =>
            records.delete('symptom_entry', id),
          )
        }
      />,
    );
    expect(await screen.findByText(/삭제가 완료되지 않았어요/)).toBeTruthy();
    expect(screen.getByText(entry.description)).toBeTruthy();
    await view.unmount();
  } finally {
    close();
  }
});
