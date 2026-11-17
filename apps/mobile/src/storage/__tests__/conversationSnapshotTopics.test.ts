import {
  healthContextFixture,
  window,
} from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import {
  healthObservation,
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { healthContextRevision } from '../../healthEvidence/healthContext/scope';
import type { HealthContextTopic } from '../../healthEvidence/healthContext/types';

const cutoff = '2026-10-05T00:00:00.000Z';
const late = '2026-10-05T00:00:00.0000001Z';
const eventTime = '2026-10-02T12:00:00Z';
const cases = [
  ['activity', 'activity'],
  ['sleep', 'sleep'],
  ['symptom', 'symptoms'],
  ['definition', 'medications'],
  ['assertion', 'medications'],
  ['dose', 'medications'],
] as const;
type Kind = (typeof cases)[number][0];
type Fixture = Awaited<ReturnType<typeof healthContextFixture>>;

/** Synthetic domain rows exercise the production repository and every period trigger table. */
async function importRow(
  f: Pick<Fixture, 'repository'>,
  kind: Kind,
  ingestedAt: string,
) {
  const metadata = {
    id: 'new-contributor',
    effectiveAt: eventTime,
    recordedAt: eventTime,
    ingestedAt,
    provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' as const },
  };
  switch (kind) {
    case 'activity':
      return f.repository.put('health_observation', {
        ...healthObservation(metadata.id, 'step_count', eventTime),
        ingestedAt,
      });
    case 'sleep':
      return f.repository.put('health_observation', {
        ...healthObservation(
          metadata.id,
          'HKCategoryTypeIdentifierSleepAnalysis',
          '2026-09-30T23:00:00Z',
          'healthkit',
          'imported',
          '2026-10-01T07:00:00Z',
        ),
        ingestedAt,
      });
    case 'symptom':
      return f.repository.put('symptom_entry', {
        ...metadata,
        description: 'Synthetic symptom',
        status: 'active',
      });
    case 'definition':
      return f.repository.put(
        'medication_definition',
        medicationDefinition(metadata.id, ingestedAt),
      );
    case 'assertion':
      return f.repository.put('medication_assertion', {
        ...metadata,
        assertionKind: 'prescribed',
        medicationName: 'Synthetic medication',
      });
    case 'dose':
      return f.repository.put('dose_event', {
        ...importedDoseEvent(metadata.id, eventTime, 'taken'),
        ingestedAt,
      });
  }
}

async function setup(topic: HealthContextTopic) {
  const f = await healthContextFixture();
  // The dose resolves to an existing, in-snapshot medication catalog row.
  await f.repository.put(
    'medication_definition',
    medicationDefinition('medication-1', '2026-10-01T00:00:00Z'),
  );
  const scope = {
    kind: 'health_context_period' as const,
    version: 1 as const,
    topic,
    window: { ...window, dataAvailableThrough: cutoff },
  };
  const report = await f.read(scope.window, [topic]);
  const revision = healthContextRevision(scope, report);
  const original = f.saved.sources[0]!;
  const source = {
    ...original,
    kind: 'health_context_period' as const,
    scope,
    revision,
    deletionGeneration: report.deletionGeneration,
    reference: {
      ...original.reference,
      locator: scope,
      sourceRevision: revision,
      evidenceRevision: revision,
    },
  };
  const storage = createConversationArtifactStorage(f.database);
  await storage.createSession('session', await storage.currentGeneration());
  await storage.append({
    id: 'completed',
    sessionId: 'session',
    createdAt: cutoff,
    question: 'Synthetic topic report',
    answer: 'Synthetic retained answer',
    providerId: 'synthetic',
    modelId: 'synthetic',
    status: 'complete',
    sources: [source],
    citations: [source.reference],
  });
  return { ...f, scope, revision, storage };
}

test.each(cases)(
  '%s late import preserves the bounded %s snapshot after reopen',
  async (kind, topic) => {
    const f = await setup(topic);
    try {
      expect(await f.storage.read('completed')).not.toBeNull();
      await importRow(f, kind, late);
      expect(
        healthContextRevision(f.scope, await f.read(f.scope.window, [topic])),
      ).toBe(f.revision);
      const reopened = createConversationArtifactStorage(f.database);
      expect(await reopened.read('completed')).not.toBeNull();
      expect(
        (await reopened.listTimeline('session', 0)).items.map(item => item.id),
      ).toEqual(['completed']);
    } finally {
      f.close();
    }
  },
);

test.each(cases)(
  '%s import at the cutoff still invalidates the %s snapshot',
  async (kind, topic) => {
    const f = await setup(topic);
    try {
      expect(await f.storage.read('completed')).not.toBeNull();
      await importRow(f, kind, cutoff);
      expect(await f.storage.read('completed')).toBeNull();
      expect((await f.storage.listTimeline('session', 0)).items).toEqual([]);
    } finally {
      f.close();
    }
  },
);
