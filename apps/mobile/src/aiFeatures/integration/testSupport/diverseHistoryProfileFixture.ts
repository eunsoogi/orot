import { quarantinedHistoryFixture } from './quarantinedHistoryFixture';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { captureSymptomSummarySources } from '../symptomSummarySources';
import { fingerprint } from '../evidenceUtils';
import type { ConversationArtifact } from '../../../storage/conversationArtifactCodec';

/** Synthetic distinct windows and ancestry, with no user records or validation bypass. */
export async function diverseHistoryProfileFixture(
  count: number,
  nested: boolean,
  fromInclusive = '2026-10-01T00:00:00Z',
) {
  const f = await quarantinedHistoryFixture();
  const summaries = createSymptomSummaryStorage(f.database);
  const template = (await f.storage.read('older'))!;
  const longHistory = fromInclusive < '2026-10-01T00:00:00Z';
  await f.database.execute('DELETE FROM conversation_artifacts');
  // Include dense sensor days, gaps and both quantity families in the long
  // profile. Workouts overlap some synthetic heart samples, including points.
  if (longHistory) {
    const start = Date.parse(fromInclusive);
    const records = Array.from({ length: 7200 }, (_, index) => {
      const minute = 60 * 1000;
      const day = 24 * 60 * minute;
      const timestamp =
        start + Math.floor(index / 6) * day + (index % 6) * minute;
      const at = new Date(timestamp).toISOString();
      const concept = ['heart_rate', 'step_count', 'workout_duration'][
        index % 6 === 2 && index % 30 === 2 ? 2 : index % 2
      ];
      return {
        ...f.inside,
        id: `synthetic-period-${index}`,
        concept,
        effectiveAt: at,
        endedAt: new Date(
          timestamp + (concept === 'workout_duration' ? 30 * minute : 0),
        ).toISOString(),
        ingestedAt: new Date(
          timestamp + (index % 29 === 0 ? 300 * day : 0),
        ).toISOString(),
        recordedAt: at,
      };
    });
    await f.database.execute(
      `INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json)
       SELECT json_extract(value,'$.id'),json_extract(value,'$.effectiveAt'),json_extract(value,'$.recordedAt'),json_extract(value,'$.ingestedAt'),value FROM json_each(?)`,
      [JSON.stringify(records)],
    );
  }
  let parent: ConversationArtifact | undefined;
  for (let index = 0; index < count; index++) {
    const toExclusive = new Date(Date.UTC(2026, 9, index + 2)).toISOString();
    const window = {
      fromInclusive,
      toExclusive,
      timeZone: longHistory ? 'Asia/Seoul' : 'UTC',
      ...(longHistory ? { dataAvailableThrough: toExclusive } : {}),
    };
    const topic = longHistory && index % 2 === 1 ? 'activity' : 'measurements';
    const report = await f.read(window, [topic]);
    const item = registerHealthContextEvidence({
      registry: f.registry,
      read: f.read,
      report,
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic,
        window,
      },
    });
    const captured = await captureSymptomSummarySources(
      {
        presentation: 'symptom_summary',
        hypotheses: [
          {
            title: 'Synthetic',
            summary: 'Synthetic',
            supportingEvidence: [item],
            contraryEvidence: [],
            missingData: [],
            uncertainty: '',
          },
        ],
      },
      f.registry,
      new AbortController().signal,
    );
    const summary = {
      ...f.saved,
      ...captured,
      id: `summary-${index}`,
      inputLineage: 'complete' as const,
    };
    await summaries.append(summary);
    const reference = {
      ...template.citations![0]!,
      sourceId: summary.id,
      evidenceId: summary.id,
      sourceRevision: fingerprint(summary),
      evidenceRevision: fingerprint(summary),
    };
    const sources: ConversationArtifact['sources'][number][] = [
      {
        kind: 'generated_summary',
        reference,
        id: summary.id,
        revision: fingerprint(summary),
      },
    ];
    const citations = [reference];
    if (nested && parent) {
      const parentReference = {
        ...reference,
        sourceId: parent.id,
        evidenceId: parent.id,
        sourceRevision: fingerprint(parent),
        evidenceRevision: fingerprint(parent),
        locator: { kind: 'generated_artifact', type: 'conversation_turn' },
      };
      sources.push({
        kind: 'generated_conversation',
        reference: parentReference,
        id: parent.id,
        revision: fingerprint(parent),
      });
      citations.push(parentReference);
    }
    parent = {
      ...template,
      id: `turn-${index}`,
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      sources,
      citations,
    };
    await f.storage.append(parent);
  }
  await f.open();
  return f;
}
