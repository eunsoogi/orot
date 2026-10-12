import { createStorageProbeFixtures } from '../storageProbeFixtures';

test('preserves the original fixture and RAG relationships by default', () => {
  const data = createStorageProbeFixtures();
  expect(data.sampleRecord.id).toBe('storage-e2e-record');
  expect(data.sampleRecord.contentHash).toBe('sha256:' + 'c'.repeat(64));
  expect(data.ragTranscript.audioRange).toEqual({ startMs: 250, endMs: 1800 });
  expect(data.ragObservation.value).toEqual({
    kind: 'quantity',
    amount: 70.5,
    unit: 'kg',
  });
});
test('namespaces every source, evidence and transcript relationship for independent UI and integration cases', () => {
  const scope = 'test-storage-AAAAAAAA-1111-2222-3333-444444444444';
  const data = createStorageProbeFixtures(scope);
  expect(data.sampleRecord.id).toBe(scope + ':storage-e2e-record');
  expect(data.sampleEvidenceSpan.sourceRecordId).toBe(data.sampleRecord.id);
  expect(data.ragMedicationSpan.provenance.sourceRecordIds).toEqual([
    data.sampleRecord.id,
  ]);
  expect(data.ragTranscript.recordingSourceId).toBe(
    data.ragAudioSourceRecord.id,
  );
  expect(data.staleTranscriptSpan.provenance.sourceRecordIds).toEqual([
    data.ragAudioSourceRecord.id,
    data.ragTranscript.id,
  ]);
  expect(data.sampleRecord.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(data.sampleRecord.contentHash).not.toBe(
    createStorageProbeFixtures().sampleRecord.contentHash,
  );
});
test('rejects a scope outside the synthetic namespace', () => {
  expect(() => createStorageProbeFixtures('real-record')).toThrow(
    'Invalid synthetic storage fixture identifier',
  );
});
