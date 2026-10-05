import { applyBloodPressureChanges } from '../importChanges';
import {
  bloodPressureSampleTypeIdentifiers as typeIds,
  type BloodPressureObservation,
  type BloodPressureTransaction,
  type BloodPressureWriter,
} from '../types';

function sample(value = 120) {
  return {
    id: 'correlation-1',
    typeIdentifier: typeIds.correlation,
    startDate: '2026-10-02T12:34:56.123456789Z',
    endDate: '2026-10-02T12:34:56.123456789Z',
    sourceIdentifier: 'com.example.device',
    sourceName: 'Blood pressure monitor',
    components: [
      {
        id: 'systolic-1',
        typeIdentifier: typeIds.systolic,
        startDate: '2026-10-02T12:34:56.123456789Z',
        endDate: '2026-10-02T12:34:56.123456789Z',
        sourceIdentifier: 'com.example.device',
        sourceName: 'Blood pressure monitor',
        originalValue: value,
        originalUnit: 'mmHg',
      },
    ],
  };
}

function memoryWriter() {
  let records = new Map<string, BloodPressureObservation>();
  const writer: BloodPressureWriter = {
    async transaction(operation) {
      const pending = new Map(records);
      const transaction: BloodPressureTransaction = {
        async upsert(observation) {
          pending.set(observation.id, observation);
        },
        async delete(correlationId) {
          pending.delete(correlationId);
        },
      };
      const result = await operation(transaction);
      records = pending;
      return result;
    },
  };
  return { writer, records: () => records };
}

describe('applyBloodPressureChanges', () => {
  it('upserts by stable correlation ID so replay and changed observations are idempotent', async () => {
    const store = memoryWriter();
    const page = { insertedOrUpdated: [sample()], deletedCorrelationIds: [] };

    await applyBloodPressureChanges(page, store.writer);
    await applyBloodPressureChanges(page, store.writer);
    expect(store.records().size).toBe(1);

    await applyBloodPressureChanges(
      { ...page, insertedOrUpdated: [sample(130)] },
      store.writer,
    );
    expect(store.records().get('correlation-1')?.systolic?.originalValue).toBe(
      130,
    );
    expect(store.records().get('correlation-1')?.diastolic).toBeNull();
  });

  it('deletes only explicitly reported correlations and treats an empty page as a no-op', async () => {
    const store = memoryWriter();
    await applyBloodPressureChanges(
      { insertedOrUpdated: [sample()], deletedCorrelationIds: [] },
      store.writer,
    );
    await applyBloodPressureChanges(
      { insertedOrUpdated: [], deletedCorrelationIds: [] },
      store.writer,
    );
    expect(store.records().has('correlation-1')).toBe(true);

    const deletion = {
      insertedOrUpdated: [],
      deletedCorrelationIds: ['correlation-1'],
    };
    await applyBloodPressureChanges(deletion, store.writer);
    await applyBloodPressureChanges(deletion, store.writer);
    expect(store.records().has('correlation-1')).toBe(false);
  });

  it('lets an explicit deletion win when one UUID appears in both change lists', async () => {
    const store = memoryWriter();
    await applyBloodPressureChanges(
      {
        insertedOrUpdated: [sample()],
        deletedCorrelationIds: ['correlation-1'],
      },
      store.writer,
    );
    expect(store.records().size).toBe(0);
  });
});
