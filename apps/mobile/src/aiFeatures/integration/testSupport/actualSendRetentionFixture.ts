import { captureConversationSources } from '../captureConversationSources';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { isPeriodSummarySource } from '../../../diseaseHypotheses/savedSummaries';
import { createConversationLocalAccess } from '../conversationLocalAccess';
import { createConversationSessionStorage } from '../conversationSessionStorage';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { registerConversationReadOperation } from '../conversationReadOperation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';

import { fingerprint } from '../evidenceUtils';

/** Actual storage/private-data composition, with synthetic direct and nested lineage. */
export async function actualSendRetentionFixture(variant: string, samples = 0) {
  const f = await sharedAncestryProfileFixture(1, false);
  const data = await f.input.loadLocalData();
  data.readHealthContext = createLocalEvidenceData(
    f.database,
  ).readHealthContext!;
  registerConversationReadOperation(data, async (scoped, registry) =>
    createSummaryArtifactDiscovery({
      database: f.database,
      storage: createSymptomSummaryStorage(f.database),
      data: scoped,
      registry,
    }),
  );
  const artifact = (await f.storage.read('turn-0'))!;
  const summary = (await createSymptomSummaryStorage(f.database).read(
    'summary-0',
  ))!;
  const source = summary.sources.find(isPeriodSummarySource)!;
  const original = source.scope.window;
  // Optional diagnostic-only scale uses bounded inserts, never user data.
  for (let offset = 0; offset < samples; offset += 500) {
    const rows = Array.from(
      { length: Math.min(500, samples - offset) },
      (_, i) => ({ ...f.inside, id: `scale-${offset + i}` }),
    );
    await f.database.execute(
      `INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.effectiveAt'),json_extract(value,'$.recordedAt'),json_extract(value,'$.ingestedAt'),value FROM json_each(?)`,
      [JSON.stringify(rows)],
    );
  }
  const count =
    variant === 'one'
      ? 1
      : variant === 'same-six' || variant === 'nested-six'
        ? 6
        : variant === 'same-twelve'
          ? 12
          : 3;
  let parent:
    | import('../../../storage/conversationArtifactCodec').ConversationArtifact
    | undefined;
  for (let index = 0; index < count; index++) {
    const window =
      variant === 'distinct-three'
        ? {
            ...original,
            toExclusive: new Date(Date.UTC(2026, 9, index + 2)).toISOString(),
          }
        : original;
    const item = registerHealthContextEvidence({
      registry: f.input.registry,
      read: data.readHealthContext!,
      report: await data.readHealthContext!(window, [source.scope.topic]),
      scope: { ...source.scope, window },
    });
    const captured = await captureConversationSources(
      [item],
      f.input.registry,
      new AbortController().signal,
    );
    const row = {
      ...artifact,
      id: `direct-${index}`,
      question: `Synthetic direct question ${index}`,
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      sources: [...captured.sources],
      citations: [captured.sources[0]!.reference],
    };
    if (variant.startsWith('nested') && parent) {
      const revision = fingerprint(parent);
      const ref = {
        ...artifact.citations![0]!,
        sourceId: parent.id,
        evidenceId: parent.id,
        sourceRevision: revision,
        evidenceRevision: revision,
        locator: { kind: 'generated_artifact', type: 'conversation_turn' },
      };
      row.sources.push({
        kind: 'generated_conversation',
        id: parent.id,
        revision,
        reference: ref,
      });
      row.citations.push(ref);
    }
    await f.storage.append(row);
    parent = row;
  }
  // Match the shipping localData composition rather than injecting one raw store.
  const nativeTransaction = f.database.transaction.bind(f.database);
  let queue = Promise.resolve();
  f.database.transaction = work => {
    const next = queue.then(() => nativeTransaction(work));
    queue = next.catch(() => undefined);
    return next;
  };
  Object.assign(
    data,
    createConversationLocalAccess(f.database, () => data, {
      storage: async () =>
        jest.requireActual('../../../storage/conversationArtifactStorage'),
      notifications: async () =>
        jest.requireActual(
          '../../../replyNotifications/replyNotificationStorage',
        ),
      discovery: async () =>
        jest.requireActual('../conversationArtifactDiscovery'),
    }),
  );
  const open = createConversationSessionStorage(f.input.loadLocalData);
  await open();
  // Invalidate the bounded global report cache without changing this source window.
  await f.repository.put('health_observation', {
    ...f.inside,
    id: 'future-profile',
    effectiveAt: '2027-01-01T00:00:00Z',
    ingestedAt: '2027-01-01T00:00:00Z',
    recordedAt: '2027-01-01T00:00:00Z',
  });
  return { f, data, count, original };
}
