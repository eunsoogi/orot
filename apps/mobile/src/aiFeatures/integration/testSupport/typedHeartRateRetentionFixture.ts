import { HealthObservationSchema } from '@orot/domain';
import type { actualSendRetentionFixture } from './actualSendRetentionFixture';
import { restoreColdConversationRegistry } from '../restoreColdConversationRegistry';
import type { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

const period = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-03T00:00:00Z',
};
export const scope = { category: 'resting_heart_rate', ...period };
export const fixtureBpm = 63;
export const record = HealthObservationSchema.parse({
  id: 'healthkit:restingHeartRate:private-source',
  effectiveAt: '2026-10-02T00:00:00Z',
  recordedAt: '2026-10-02T00:00:00Z',
  ingestedAt: '2026-10-02T00:00:00Z',
  provenance: {
    origin: 'imported',
    sourceRecordIds: ['private-source'],
    source: { system: 'healthkit' },
  },
  reviewState: { status: 'unreviewed' },
  observationKind: 'measurement',
  concept: 'resting_heart_rate',
  value: { kind: 'quantity', amount: fixtureBpm, unit: 'count/min' },
});

type Fixture = Awaited<ReturnType<typeof actualSendRetentionFixture>>;

export async function assertTypedHeartRateRetention(
  f: Fixture['f'],
  data: Fixture['data'],
  acceptedSnapshot: ReturnType<LocalEvidenceReferenceRegistry['snapshot']>,
  signal: AbortSignal,
) {
  const saved = await f.storage.read('typed-answer');
  expect(saved?.sources[0]).toMatchObject({
    kind: 'health_context_period',
    scope: {
      window: { typedHeartRateCategory: 'resting_heart_rate', ...period },
    },
  });
  expect(
    await f.storage.readProtectedPromptHistory(
      'session',
      (await f.storage.activeSessionVersion('session'))!,
      ['typed-answer'],
      signal,
    ),
  ).toEqual([]);
  await expect(
    restoreColdConversationRegistry({
      snapshot: acceptedSnapshot,
      sources: saved!.sources,
      data,
      signal: signal,
    }),
  ).rejects.toThrow('new typed heart-rate approval');
  await f.repository.delete('health_observation', record.id);
  await expect(f.storage.read('typed-answer')).resolves.toBeNull();
}
