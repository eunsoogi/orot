import type { HealthObservation } from '@orot/domain';
import {
  getCipherVersion,
  openLocalStorage,
} from '../src/storage/secureDatabase';

/** Both phases use the shipping encrypted database and repository, separated by the host's cold-process reset. */
export async function runFixtureIsolationTestOperation(
  mode: unknown,
  token: unknown,
) {
  if (
    (mode !== 'seed' && mode !== 'verify') ||
    typeof token !== 'string' ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token)
  )
    throw new Error('Fixture isolation requires its exact host phase and UUID');
  const repository = await openLocalStorage();
  if (!(await getCipherVersion()))
    throw new Error('Fixture isolation requires real SQLCipher');
  const identifier = 'isolation-' + token;
  const observation: HealthObservation = {
    id: identifier,
    effectiveAt: '2026-10-01T00:00:00.000Z',
    recordedAt: '2026-10-01T00:00:00.000Z',
    ingestedAt: '2026-10-01T00:00:00.000Z',
    provenance: {
      origin: 'imported',
      sourceRecordIds: [],
      source: { system: 'synthetic-isolation' },
    },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept: 'heart_rate',
    value: { kind: 'quantity', amount: 73, unit: 'count/min' },
  };
  const previous = await repository.get('health_observation', identifier);
  if (previous !== null)
    throw new Error('Fixture isolation retained the previous process record');
  if (mode === 'seed') {
    await repository.put('health_observation', observation);
    const restored = await repository.get('health_observation', identifier);
    if (JSON.stringify(restored) !== JSON.stringify(observation))
      throw new Error(
        'Fixture isolation did not persist its contamination row',
      );
  }
  return {
    encrypted: true,
    seeded: mode === 'seed',
    oldRecordAbsent: mode === 'verify',
    identifier,
  };
}
