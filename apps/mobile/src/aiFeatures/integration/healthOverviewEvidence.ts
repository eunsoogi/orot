import type { EvidenceItem, EvidenceSearchRequest } from '@orot/agent-runtime';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import {
  HEALTH_OVERVIEW_GROUP_LIMITS,
  healthOverviewGroup,
  type HealthOverviewGroup,
} from '../../healthEvidence/healthOverviewScope';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';
import {
  LocalEvidenceReferenceRegistry,
  type EvidenceSourceReadResult,
} from './evidenceRegistry';
import { healthOverviewFacts } from './healthOverviewFacts';
import { scopedEvidenceItems } from './evidenceItemScope';
import {
  fingerprint,
  jsonByteLength,
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
  stableJson,
} from './evidenceUtils';

/** One explicit model-selected read supplies bounded samples by topic, not a computed diagnosis or exhaustive totals. */
export function healthOverviewEvidence(
  snapshot: LocalEvidenceSnapshot,
  registry: LocalEvidenceReferenceRegistry,
  request: EvidenceSearchRequest,
  maxResults: number,
) {
  if (request.signal.aborted)
    throw new Error('Overview selection was cancelled.');
  const groups = new Map<HealthOverviewGroup, EvidenceItem[]>();
  const rows = snapshot.personalRecords;
  for (const item of scopedEvidenceItems(
    snapshot.items,
    request,
    'personal_record',
  )) {
    const entry = rows?.get(item.evidenceId);
    const group = entry && healthOverviewGroup(entry);
    if (!group) continue;
    const selected = groups.get(group) ?? [];
    selected.push(item);
    groups.set(group, selected);
  }
  const items: EvidenceItem[] = [];
  const base = snapshot.coverage.find(
    value => value.sourceKind === 'personal_record',
  );
  const batch = (selected: EvidenceItem[]) => ({
    items: selected,
    coverage: [
      {
        sourceKind: 'personal_record' as const,
        selectionMethod: 'ranked_retrieval' as const,
        searchedSourceIds: selected.map(item => item.sourceId),
        ...(request.allowedScope.timeRange
          ? { requestedTimeRange: request.allowedScope.timeRange }
          : {}),
        gaps: [...(base?.gaps ?? [])],
        truncated: true,
        resultLimit: request.resultLimit,
        returnedCount: selected.length,
      },
    ],
    conflicts: [],
  });
  for (const [topic, candidates] of groups) {
    // Definitions identify the registered medication set; assertions must not crowd its names out.
    const references = [...candidates]
      .sort(
        (a, b) =>
          Number(rows!.get(b.evidenceId)!.kind === 'medication_definition') -
          Number(rows!.get(a.evidenceId)!.kind === 'medication_definition'),
      )
      .slice(0, HEALTH_OVERVIEW_GROUP_LIMITS[topic]);
    if (items.length >= Math.min(maxResults, request.resultLimit)) break;
    const original = references.map(ref => registry.resolve(ref));
    if (original.some(ref => !ref))
      throw new Error('Overview sources are unavailable.');
    const revision = fingerprint(original);
    const id = `health-overview-${topic}-${revision}`;
    const readSource = async (
      signal: AbortSignal,
    ): Promise<EvidenceSourceReadResult> => {
      const records = new Map<string, LocalHealthEvidenceRecord>();
      for (const reference of references) {
        if (signal.aborted) return { status: 'unavailable' };
        const read = await registry.readSource(reference, signal);
        if (read.status !== 'available') return read;
        if (read.document.sourceKind !== 'personal_record')
          return { status: 'unavailable' };
        for (const entry of read.document.records)
          records.set(`${entry.kind}:${entry.record.id}`, entry);
        if (records.size > 32) return { status: 'unavailable' };
      }
      return {
        status: 'available',
        document: {
          sourceKind: 'personal_record',
          records: [...records.values()],
        },
      };
    };
    const item = registry.add({
      reference: {
        sourceKind: 'personal_record',
        sourceId: id,
        sourceRevision: revision,
        evidenceId: id,
        evidenceRevision: revision,
        // Raw member identities stay in the local registry/SQLCipher history, never the provider-facing locator.
        locator: {
          kind: 'health_overview',
          topic,
          references: original.map(ref => ({ ...ref! })),
        },
        effectiveTime: request.allowedScope.timeRange
          ? references
              .map(ref => ref.effectiveTime!)
              .sort((a, b) => Date.parse(b) - Date.parse(a))[0]!
          : null,
        reviewState: references.every(ref => ref.reviewState === 'reviewed')
          ? 'reviewed'
          : 'unknown',
      },
      content: `health_overview: ${stableJson({ topic, selection: 'bounded_recent_samples_not_exhaustive', records: references.map(ref => healthOverviewFacts(rows!.get(ref.evidenceId)!)) })}`,
      readSource,
      validate: signal => registry.revalidateEvidence(references, signal),
    });
    if (
      jsonByteLength(batch([...items, item])) >
      Math.min(request.maxPayloadBytes, MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES)
    ) {
      continue;
    }
    items.push(item);
  }
  return batch(items);
}
