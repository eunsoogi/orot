import type { EvidenceItem } from '@orot/agent-runtime';
import type { ConversationEntryContext } from './conversationIntent';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { createDailyReportSourceResolver } from './dailyReportSources';
import { healthOverviewFacts } from './healthOverviewFacts';
import {
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
  jsonByteLength,
  stableJson,
  utf8ByteLength,
} from './evidenceUtils';
import { RAG_CONVERSATION_BUDGET } from '../../ragConversation/budget';
import type { AiFeatureLocalData } from './localData';

/** Pin only cited local facts, and check the report head and source revisions on every dispatch. */
export async function prepareDailyReportConversationEvidence(input: {
  report: NonNullable<ConversationEntryContext['dailyReport']>;
  resolve: ReturnType<typeof createDailyReportSourceResolver>;
  registry: LocalEvidenceReferenceRegistry;
  loadLocalData: () => Promise<AiFeatureLocalData>;
  signal: AbortSignal;
}) {
  const read = () =>
    input.resolve(
      input.report.identity,
      input.report.runId,
      input.report.revision,
      input.signal,
    );
  const initial = await read();
  if (initial.status !== 'current' || input.signal.aborted) return null;
  if (initial.sources.length > RAG_CONVERSATION_BUDGET.maxEvidenceItems)
    return null;
  const originals = initial.sources.map(source =>
    input.registry.resolve(source),
  );
  if (
    originals.some(source => !source || source.sourceKind !== 'personal_record')
  )
    return null;
  const items: EvidenceItem[] = [];
  const data = await input.loadLocalData();
  for (const [index, source] of initial.sources.entries()) {
    const result = await input.registry.readSource(source, input.signal);
    if (
      result.status !== 'available' ||
      result.document.sourceKind !== 'personal_record'
    )
      return null;
    const content =
      'health_overview: ' +
      JSON.stringify({
        records: result.document.records.map(healthOverviewFacts),
      });
    if (utf8ByteLength(content) > MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES)
      return null;
    for (const id of await data.findIdentifiers(content, input.signal))
      input.registry.registerSensitiveIdentifier(id);
    const original = originals[index]!;
    // The report locator identifies its snapshot entry; the deletion guard needs the stored row identity.
    items.push(
      input.registry.add({
        reference: {
          ...original,
          locator: { kind: 'structured_record', recordId: original.evidenceId },
        },
        content,
        readSource: signal => input.registry.readSource(source, signal),
        validate: signal => input.registry.revalidateEvidence([source], signal),
      }),
    );
    if (jsonByteLength(items) > MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES) return null;
  }
  const expected = stableJson(originals);
  const isCurrent = async () => {
    if (input.signal.aborted) return false;
    const latest = await read();
    return (
      latest.status === 'current' &&
      stableJson(
        latest.sources.map(source => input.registry.resolve(source)),
      ) === expected &&
      (items.length === 0 ||
        (await input.registry.revalidateEvidence(items, input.signal))) &&
      !input.signal.aborted
    );
  };
  return (await isCurrent()) ? { items, isCurrent } : null;
}
