import { reportTargetFailure } from '../../providers/reportTargetDiagnostic';
import type { EvidenceItem } from '@orot/agent-runtime';
import type { ConversationEntryContext } from './conversationIntent';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { createDailyReportSourceResolver } from './dailyReportSources';
import {
  providerRecordFacts,
  addProviderJsonEvidence,
  providerObservationEvidence,
} from './providerObservationEvidence';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import { stableJson } from './evidenceUtils';
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
  if (input.signal.aborted)
    return reportTargetFailure('report_target_cancelled');
  if (initial.status !== 'current')
    return reportTargetFailure(
      initial.status === 'stale'
        ? 'report_target_stale'
        : initial.status === 'deleted'
          ? 'report_target_deleted'
          : 'report_target_unavailable',
    );
  // Without any cited record, sending the turn would silently drop the selected report.
  if (!initial.sources.length)
    return reportTargetFailure('report_target_empty');
  const originals = initial.sources.map(source =>
    input.registry.resolve(source),
  );
  if (
    originals.some(source => !source || source.sourceKind !== 'personal_record')
  )
    return reportTargetFailure('report_target_registry_missing');
  const items: EvidenceItem[] = [];
  const rows = new Map<string, LocalHealthEvidenceRecord>();
  const data = await input.loadLocalData();
  for (const [index, source] of initial.sources.entries()) {
    const result = await input.registry.readSource(source, input.signal);
    if (
      result.status !== 'available' ||
      result.document.sourceKind !== 'personal_record'
    )
      return reportTargetFailure('report_target_source_unavailable');
    const content =
      'health_overview: ' +
      JSON.stringify({
        ...providerRecordFacts(result.document.records),
      });
    // Preserve complete cited facts; provider capacity is not a local evidence rejection.
    for (const id of await data.findIdentifiers(content, input.signal))
      input.registry.registerSensitiveIdentifier(id);
    const original = originals[index]!;
    // The report locator identifies its snapshot entry; the deletion guard needs the stored row identity.
    const item = addProviderJsonEvidence(input.registry, {
      reference: {
        ...original,
        locator: { kind: 'structured_record', recordId: original.evidenceId },
      },
      value: providerRecordFacts(result.document.records),
      prefix: 'health_overview: ',
      readSource: signal => input.registry.readSource(source, signal),
      validate: signal => input.registry.revalidateEvidence([source], signal),
    });
    items.push(item);
    const row = result.document.records.find(
      record => record.record.id === original.evidenceId,
    );
    if (row) rows.set(item.evidenceId, row);
  }
  const projected = providerObservationEvidence(items, rows, input.registry);
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
  return (await isCurrent())
    ? { items: projected, isCurrent }
    : reportTargetFailure('report_target_recheck');
}
