import type { SavedSummarySource } from '../../../diseaseHypotheses/savedSummaries';
import { isConversationPhotoSource } from '../../../ragConversation/conversationArtifactSources';
import type { actualSendRetentionFixture } from './actualSendRetentionFixture';
import { isPeriodSummarySource } from '../../../diseaseHypotheses/savedSummaries';
import { registerHealthContextEvidence } from '../healthContextEvidence';
import { captureConversationToolSources } from '../captureConversationToolSources';

/** Persist real tool dependencies without injecting their aliases into send admission.
 * Whether shipping history admits them is part of the experiment, not a mock rule. */
export async function appendSyntheticPriorTools(
  f: Awaited<ReturnType<typeof actualSendRetentionFixture>>['f'],
  data: Awaited<ReturnType<typeof actualSendRetentionFixture>>['data'],
  count: number,
) {
  for (let index = 0; index < count; index++) {
    const row = (await f.storage.read(`direct-${index}`))!;
    const source = row.sources
      .filter(
        (candidate): candidate is SavedSummarySource =>
          !isConversationPhotoSource(candidate),
      )
      .find(isPeriodSummarySource)!;
    const item = registerHealthContextEvidence({
      registry: f.input.registry,
      read: data.readHealthContext!,
      report: await data.readHealthContext!(source.scope.window, [
        source.scope.topic,
      ]),
      scope: source.scope,
    });
    const captured = await captureConversationToolSources(
      {
        version: 1,
        operationRunId: 'synthetic-prior',
        callId: `call-${index}`,
        toolName: 'health',
        order: index + 1,
        status: 'completed',
        inputSummary: { sourceKind: item.sourceKind },
        resultSummary: { referenceCount: 1 },
        sources: [item],
      },
      f.input.registry,
    );
    await f.storage.appendToolEvent({
      sessionId: 'session',
      messageId: row.id,
      createdAt: row.createdAt,
      sessionVersion: (await f.storage.activeSessionVersion('session'))!,
      ...captured,
    });
  }
  expect(
    (await f.storage.readToolTurns('session')).flatMap(row => row.toolEvents),
  ).toHaveLength(count);
}
