import { createLocalQueryProbeFixtures } from '../e2e/localRecordQueryProbeFixtures';
import { createScopedQueryProbeFixtures } from '../e2e/scopedQueryProbeFixtures';

const first = 'test-query-11111111-2222-4333-8444-555555555555';
const second = 'test-query-99999999-aaaa-4bbb-8ccc-dddddddddddd';

test('preserves the complete original fresh-install fixture when no scope is requested', () => {
  expect(createScopedQueryProbeFixtures()).toEqual(
    createLocalQueryProbeFixtures(),
  );
});

test('scopes every stored identity, provenance reference and source hash consistently', () => {
  const original = createLocalQueryProbeFixtures();
  const fixture = createScopedQueryProbeFixtures(first);
  expect(fixture.healthSource.id).toBe(first + ':' + original.healthSource.id);
  expect(fixture.audioSource.id).toBe(first + ':' + original.audioSource.id);
  for (const row of fixture.healthRows) {
    expect(row.id.startsWith(first + ':')).toBe(true);
    expect(row.provenance.sourceRecordIds).toEqual([fixture.healthSource.id]);
  }
  expect(fixture.transcript.recordingSourceId).toBe(fixture.audioSource.id);
  expect(fixture.transcript.transcriptId).toBe(
    first + ':' + original.transcript.transcriptId,
  );
  expect(fixture.dose.medicationDefinitionId).toBe(fixture.medication.id);
  expect(fixture.transcript.provenance.sourceRecordIds).toEqual([
    fixture.audioSource.id,
  ]);
  for (const row of [
    fixture.dose,
    fixture.medication,
    fixture.appointment,
    fixture.transcript,
  ])
    expect(row.id.startsWith(first + ':')).toBe(true);
  for (const source of [fixture.healthSource, fixture.audioSource])
    expect(source.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  const another = createScopedQueryProbeFixtures(second);
  expect(
    new Set([
      fixture.healthSource.contentHash,
      fixture.audioSource.contentHash,
      another.healthSource.contentHash,
      another.audioSource.contentHash,
    ]).size,
  ).toBe(4);
  expect(fixture.appointment.calendarEventIdentifier).toBe(
    original.appointment.calendarEventIdentifier,
  );
  expect(fixture.transcript.text).toBe(original.transcript.text);
  expect(original).toEqual(createLocalQueryProbeFixtures());
});

test('rejects invalid scope values before exposing a reusable fixture', () => {
  for (const value of [
    '',
    'test-query-personal',
    '../records',
    first + ':extra',
  ])
    expect(() => createScopedQueryProbeFixtures(value)).toThrow(
      'Invalid local query fixture identifier',
    );
});
