import { createLocalQueryProbeFixtures } from './localRecordQueryProbeFixtures';

type QueryFixtures = ReturnType<typeof createLocalQueryProbeFixtures>;

/** Give each reusable native case its own source identities without changing the legacy fresh-install fixture. */
export function createScopedQueryProbeFixtures(
  identifier?: string,
): QueryFixtures {
  const fixtures = createLocalQueryProbeFixtures();
  if (identifier === undefined) return fixtures;
  if (
    !/^test-query-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      identifier,
    )
  )
    throw new Error('Invalid local query fixture identifier');

  const identities = [
    fixtures.healthSource.id,
    fixtures.audioSource.id,
    ...fixtures.healthRows.map(row => row.id),
    fixtures.dose.id,
    fixtures.medication.id,
    fixtures.appointment.id,
    fixtures.transcript.id,
    fixtures.transcript.transcriptId,
  ];
  const replacements = new Map(
    identities.map(id => [id, identifier + ':' + id]),
  );
  const digestPrefix = identifier
    .slice('test-query-'.length)
    .replaceAll('-', '')
    .toLowerCase();
  replacements.set(
    fixtures.healthSource.contentHash,
    'sha256:' + digestPrefix + 'c'.repeat(32),
  );
  replacements.set(
    fixtures.audioSource.contentHash,
    'sha256:' + digestPrefix + 'd'.repeat(32),
  );
  // Fixtures are plain JSON. Replace exact identities everywhere, including provenance and transcript relationships.
  // Unique synthetic hashes keep a prior privacy tombstone from rejecting a later independent test case.
  return JSON.parse(
    JSON.stringify(fixtures, (_key, value: unknown) =>
      typeof value === 'string' ? (replacements.get(value) ?? value) : value,
    ),
  ) as QueryFixtures;
}
