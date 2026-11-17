import type { EvidenceItem } from '@orot/agent-runtime';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import type {
  LocalEvidenceReferenceRegistry,
  EvidenceSourceReadResult,
} from './evidenceRegistry';
import {
  isBulkSensorObservation,
  summarizeProviderObservations,
} from './providerObservationProjection';
import { healthOverviewFacts } from './healthOverviewFacts';
import { fingerprint } from './evidenceUtils';

/** Redact identifiers only in textual leaves, never in counts or numeric statistics. */
export function providerJsonContent(
  registry: LocalEvidenceReferenceRegistry,
  value: unknown,
  prefix = '',
): string {
  const visit = (entry: unknown): unknown => {
    if (typeof entry === 'string') return registry.redactText(entry);
    if (Array.isArray(entry)) return entry.map(visit);
    if (entry && typeof entry === 'object')
      return Object.fromEntries(
        Object.entries(entry).map(([key, child]) => [key, visit(child)]),
      );
    return entry;
  };
  return prefix + JSON.stringify(visit(value));
}

/** Registration keeps original source identities; serialization preserves typed numbers. */
export function addProviderJsonEvidence(
  registry: LocalEvidenceReferenceRegistry,
  input: Omit<
    Parameters<LocalEvidenceReferenceRegistry['add']>[0],
    'content'
  > & { value: unknown; prefix?: string },
): EvidenceItem {
  const item = registry.add({ ...input, content: '' });
  return {
    ...item,
    content: providerJsonContent(registry, input.value, input.prefix),
  };
}

/** Bulk provider projection is distinct from the original source-detail document.
 * Symptoms, doses, clinical documents and other non-series records stay unchanged. */
export function providerRecordFacts(
  records: readonly LocalHealthEvidenceRecord[],
) {
  return {
    records: records
      .filter(record => !isBulkSensorObservation(record))
      .map(healthOverviewFacts),
    sensorSummaries: summarizeProviderObservations(records).map(
      group => group.content,
    ),
  };
}

/** Collapse only bulk sensor evidence, binding the derived fact to every original
 * member. The local reader retains the originals for UI, deletion and revision checks. */
export function providerObservationEvidence(
  items: readonly EvidenceItem[],
  rows: ReadonlyMap<string, LocalHealthEvidenceRecord>,
  registry: LocalEvidenceReferenceRegistry,
  selectedRecordId?: string,
): EvidenceItem[] {
  const sensorItems = items.filter(item => {
    const row = rows.get(item.evidenceId);
    return (
      row && row.record.id !== selectedRecordId && isBulkSensorObservation(row)
    );
  });
  if (!sensorItems.length) return [...items];
  const retained = items.filter(item => !sensorItems.includes(item));
  const groups = summarizeProviderObservations(
    sensorItems.map(item => rows.get(item.evidenceId)!),
  );
  for (const group of groups) {
    const ids = new Set(group.memberIds);
    const members = sensorItems.filter(item =>
      ids.has(rows.get(item.evidenceId)!.record.id),
    );
    const references = members.map(item => registry.resolve(item));
    if (references.some(reference => !reference))
      throw new Error('Sensor summary sources are unavailable.');
    const revision = fingerprint(references);
    const id = `sensor-summary-${revision}`;
    const readSource = async (
      signal: AbortSignal,
    ): Promise<EvidenceSourceReadResult> => {
      const records = new Map<string, LocalHealthEvidenceRecord>();
      for (const member of members) {
        if (signal.aborted) return { status: 'unavailable' };
        const read = await registry.readSource(member, signal);
        if (read.status !== 'available') return read;
        if (read.document.sourceKind !== 'personal_record')
          return { status: 'unavailable' };
        for (const record of read.document.records)
          records.set(`${record.kind}:${record.record.id}`, record);
      }
      return {
        status: 'available',
        document: {
          sourceKind: 'personal_record',
          records: [...records.values()],
        },
      };
    };
    retained.push(
      addProviderJsonEvidence(registry, {
        reference: {
          sourceKind: 'personal_record',
          sourceId: id,
          evidenceId: id,
          sourceRevision: revision,
          evidenceRevision: revision,
          locator: {
            kind: 'health_overview',
            topic: 'sensor_summary',
            references: references.map(reference => ({ ...reference! })),
          },
          effectiveTime: null,
          reviewState: members.every(item => item.reviewState === 'reviewed')
            ? 'reviewed'
            : 'unknown',
        },
        prefix: 'sensor_period_summary: ',
        value: group.content,
        readSource,
        validate: signal => registry.revalidateEvidence(members, signal),
      }),
    );
  }
  return retained;
}

/** Only the host-bound exact single source can opt into original record detail. */
export function selectedProviderRecordId(
  registry: LocalEvidenceReferenceRegistry,
  items: readonly EvidenceItem[],
  sourceIds?: readonly string[],
): string | undefined {
  if (
    sourceIds?.length !== 1 ||
    items.length !== 1 ||
    !sourceIds.includes(items[0]!.sourceId)
  )
    return undefined;
  const original = registry.resolve(items[0]!);
  return original?.sourceId === original?.evidenceId
    ? original?.evidenceId
    : undefined;
}
