import type { EvidenceReference } from '@orot/agent-runtime';
import type { DailyReportOutput } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { sensorSummaryText } from './dailyReportSensorFacts';
import {
  isBulkSensorObservation,
  summarizeProviderObservations,
} from './providerObservationProjection';

export interface DailyReportCitationPresentation {
  readonly directSources: readonly number[];
  readonly statistics: readonly (readonly number[])[];
  readonly otherSources: readonly number[];
}

type Claim = DailyReportOutput['observations'][number];

/** Recover only canonical locally generated observations. Matching raw members
 * alone cannot identify a statistic because a narrative can cite the same rows. */
export async function dailyReportCitationPresentation(
  report: Pick<DailyReportOutput, 'observations' | 'supportedContext'>,
  sources: readonly EvidenceReference[],
  registry: LocalEvidenceReferenceRegistry,
  signal: AbortSignal,
): Promise<DailyReportCitationPresentation | undefined> {
  const indexes = new Map<string, number>();
  const direct = new Set<number>();
  for (const [index, source] of sources.entries()) {
    const original = registry.resolve(source);
    const locator = original?.locator as Record<string, unknown> | undefined;
    if (
      locator?.kind === 'daily_report_source' &&
      locator.source === 'health_observation' &&
      typeof locator.recordId === 'string'
    )
      indexes.set(locator.recordId, index);
    else direct.add(index);
  }
  const statistics: number[][] = [];
  const grouped = new Set<number>();
  const explicit = new Set<number>();
  const rowsByIndex = new Map<number, LocalHealthEvidenceRecord | null>();
  for (const claim of report.observations) {
    if (signal.aborted) return undefined;
    const members = observationIndexes(claim, indexes);
    if (!members) continue;
    const rows = [];
    for (const index of members) {
      if (signal.aborted) return undefined;
      if (!rowsByIndex.has(index)) {
        const read = await registry.readSource(sources[index]!, signal);
        if (read.status !== 'available') return undefined;
        rowsByIndex.set(
          index,
          read.document.sourceKind === 'personal_record' &&
            read.document.records.length === 1
            ? (read.document.records[0] ?? null)
            : null,
        );
      }
      const row = rowsByIndex.get(index);
      if (!row || !isBulkSensorObservation(row)) break;
      rows.push(row);
    }
    const summaries =
      rows.length === members.length ? summarizeProviderObservations(rows) : [];
    const summary = summaries.length === 1 ? summaries[0] : undefined;
    if (
      !summary ||
      (!summary.content.statistics && !summary.content.sleep) ||
      sensorSummaryText(summary.content) !== claim.text ||
      summary.memberIds.length !== members.length ||
      summary.memberIds.some((id, index) => indexes.get(id) !== members[index])
    ) {
      if (members.length === 1) explicit.add(members[0]!);
      continue;
    }

    if (
      !statistics.some(
        group =>
          group.every((index, i) => members[i] === index) &&
          group.length === members.length,
      )
    )
      statistics.push(members);
    members.forEach(index => grouped.add(index));
  }
  for (const claim of report.supportedContext) {
    const members = observationIndexes(claim, indexes);
    if (members?.length === 1) explicit.add(members[0]!);
  }
  explicit.forEach(index => direct.add(index));
  return {
    statistics,
    directSources: sources.flatMap((_source, index) =>
      direct.has(index) ? [index] : [],
    ),
    otherSources: sources.flatMap((_source, index) =>
      !grouped.has(index) && !direct.has(index) ? [index] : [],
    ),
  };
}

function observationIndexes(
  claim: Claim,
  indexes: ReadonlyMap<string, number>,
) {
  const members: number[] = [];
  for (const ref of claim.sourceReferences) {
    const index = indexes.get(ref.recordId);
    if (ref.source !== 'health_observation' || index === undefined)
      return undefined;
    members.push(index);
  }
  return members.length && new Set(members).size === members.length
    ? members
    : undefined;
}
