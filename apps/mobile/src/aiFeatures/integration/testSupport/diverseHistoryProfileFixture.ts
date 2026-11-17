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
) {
  const f = await quarantinedHistoryFixture();
  const summaries = createSymptomSummaryStorage(f.database);
  const template = (await f.storage.read('older'))!;
  await f.database.execute('DELETE FROM conversation_artifacts');
  let parent: ConversationArtifact | undefined;
  for (let index = 0; index < count; index++) {
    const window = {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: new Date(Date.UTC(2026, 9, index + 2)).toISOString(),
      timeZone: 'UTC',
    };
    const report = await f.read(window, ['measurements']);
    const item = registerHealthContextEvidence({
      registry: f.registry,
      read: f.read,
      report,
      scope: {
        kind: 'health_context_period',
        version: 1,
        topic: 'measurements',
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
