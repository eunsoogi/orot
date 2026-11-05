import type { ConversationToolEvent } from '@orot/agent-runtime';
import { localQueryTimestampKey, type SqlExecutor } from '@orot/storage';
import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import { decodeConversationArtifact } from './conversationArtifactCodec';

/** Decode the existing source contract without persisting a synthetic conversation artifact. */
export function decodeToolLineage(
  value: unknown,
  event: ConversationToolEvent,
  identity: { messageId: string; sessionId: string; createdAt: string },
) {
  const artifact = decodeConversationArtifact(
    JSON.stringify({
      id: identity.messageId,
      sessionId: identity.sessionId,
      createdAt: identity.createdAt,
      providerId: 'tool',
      modelId: 'tool',
      status: 'partial',
      question: 'tool',
      answer: 'tool',
      sources: value,
    }),
  );
  if (!artifact) throw new Error('Invalid tool source lineage.');
  const local = event.sources.filter(
    source => source.sourceKind !== 'external_medical',
  );
  if (
    local.length !== artifact.sources.length ||
    local.some((source, index) => {
      const ref = artifact.sources[index]!.reference;
      return (
        source.sourceKind !== ref.sourceKind ||
        source.sourceId !== ref.sourceId ||
        source.sourceRevision !== ref.sourceRevision ||
        source.evidenceId !== ref.evidenceId ||
        source.evidenceRevision !== ref.evidenceRevision
      );
    })
  )
    throw new Error('Tool source lineage does not match its event.');
  return artifact;
}

export type ToolLineage = readonly ConversationArtifactSource[];

/** Index dependencies for the existing source deletion and freshness boundaries. */
export async function indexToolLineage(
  tx: SqlExecutor,
  sessionId: string,
  event: ConversationToolEvent,
  sources: ToolLineage,
) {
  const key = JSON.stringify([sessionId, event.operationRunId, event.callId]);
  const prefix = [key, sessionId, event.operationRunId, event.callId];
  for (const source of sources) {
    if (isPeriodSummarySource(source)) {
      await tx.execute(
        'INSERT OR IGNORE INTO conversation_tool_periods VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          ...prefix,
          source.scope.topic,
          localQueryTimestampKey(source.scope.window.fromInclusive),
          localQueryTimestampKey(source.scope.window.toExclusive),
        ],
      );
    } else if ('kind' in source && source.kind.startsWith('generated_')) {
      await tx.execute(
        'INSERT OR IGNORE INTO conversation_tool_dependencies VALUES (?, ?, ?, ?, ?, ?)',
        [...prefix, source.kind, source.id],
      );
    } else if ('records' in source) {
      for (const id of [source.reference.sourceId, source.reference.evidenceId])
        await tx.execute(
          'INSERT OR IGNORE INTO conversation_tool_dependencies VALUES (?, ?, ?, ?, ?, ?)',
          [...prefix, 'identity', id],
        );
      for (const record of source.records)
        await tx.execute(
          'INSERT OR IGNORE INTO conversation_tool_dependencies VALUES (?, ?, ?, ?, ?, ?)',
          [...prefix, record.kind, record.id],
        );
    }
  }
}
