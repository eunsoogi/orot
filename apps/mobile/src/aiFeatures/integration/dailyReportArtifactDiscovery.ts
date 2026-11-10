import type { EvidenceReference } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import { compareTimestamps, DailyReportContextSchema } from '@orot/domain';
import { createDailyReportStorage } from '../../storage/dailyReportStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { fingerprint, stableJson } from './evidenceUtils';
import { restoreRetainedSources } from './restoreRetainedSources';
import type { SavedRecordSummarySource } from '../../diseaseHypotheses/savedSummaries';

/** Read only the active, current revision; old runs never become search results. */
export async function readDailyReportArtifact(input: {
  database: SqlDatabase;
  data: AiFeatureLocalData;
  registry: LocalEvidenceReferenceRegistry;
  id: string;
  signal?: AbortSignal;
}) {
  if (input.signal?.aborted) return null;
  const row = (
    await input.database.execute(
      'SELECT r.result_json FROM symptom_summary_runs r JOIN daily_report_heads h ON h.active_run_id = r.id AND h.deleted = 0 WHERE r.id = ?',
      [input.id],
    )
  ).rows[0];
  if (typeof row?.result_json !== 'string') return null;
  let context: unknown;
  try {
    context = JSON.parse(row.result_json).context;
  } catch {
    return null;
  }
  const parsed = DailyReportContextSchema.safeParse(context);
  if (!parsed.success) return null;
  const store = createDailyReportStorage(input.database);
  const saved = await store.lookup(parsed.data.identity);
  if (saved.status !== 'saved' || saved.runId !== input.id) return null;
  const sources: SavedRecordSummarySource[] = saved.lineage.map(item => ({
    reference: {
      sourceKind:
        item.kind === 'reviewed_memory' ? 'reviewed_memory' : 'personal_record',
      sourceId: item.localId,
      evidenceId: item.localId,
      sourceRevision: item.revision,
      evidenceRevision: item.revision,
      locator: {
        kind: 'daily_report_source',
        source: item.source,
        recordId: item.recordId,
      },
      effectiveTime: null,
      reviewState: 'unreviewed',
    },
    records: [{ kind: item.kind, id: item.localId, revision: item.revision }],
  }));
  const restored = await restoreRetainedSources(
    sources,
    input.registry,
    input.data,
  );
  if (restored.sourceChanged || input.signal?.aborted) return null;
  const bySource = new Map(
    saved.lineage.map((item, index) => [
      stableJson([item.source, item.recordId]),
      restored.mapping.get(stableJson(sources[index]!.reference))!,
    ]),
  );
  const references = [
    ...new Map(
      [...bySource.values()].map(ref => [stableJson(ref), ref]),
    ).values(),
  ];
  const claims = [
    ...saved.report.observations,
    ...saved.report.supportedContext,
  ];
  const revision = fingerprint({
    runId: saved.runId,
    revision: saved.revision,
    context: saved.context,
    report: saved.report,
    lineage: saved.lineage,
  });
  const latest = await store.lookup(parsed.data.identity);
  if (
    latest.status !== 'saved' ||
    latest.runId !== saved.runId ||
    latest.revision !== saved.revision ||
    input.signal?.aborted
  )
    return null;
  return {
    metadata: {
      type: 'daily_report' as const,
      id: saved.runId,
      identity: saved.context.identity,
      dailyRevision: saved.revision,
      originFeature: 'daily_report',
      originSession: null,
      createdAt: saved.report.generatedAt,
      eventTime: saved.context.interval.fromInclusive,
      revision,
      providerId: saved.context.provider.providerId,
      modelId: saved.context.provider.modelId,
      completion: 'complete' as const,
      review: 'unreviewed' as const,
      inputLineage: 'complete' as const,
    },
    content: {
      hypotheses: [
        {
          title: `Daily report ${saved.context.identity.localDate} (${saved.context.identity.timeZone})`,
          summary: [
            ...claims.map(claim => claim.text),
            ...saved.report.followUpQuestions,
          ].join('\n'),
          supportingEvidence: claims.flatMap(claim =>
            claim.sourceReferences.map(ref =>
              bySource.get(stableJson([ref.source, ref.recordId]))!,
            ),
          ),
          contraryEvidence: [] as EvidenceReference[],
          uncertainty: `${compareTimestamps(saved.context.effectiveCutoff, saved.context.interval.toExclusive) < 0 ? 'Partial day. ' : ''}Report cutoff: ${saved.context.effectiveCutoff}. Coverage: ${JSON.stringify(saved.report.coverage)}`,
          missingData: saved.report.coverage
            .filter(
              item => item.status !== 'available' && item.status !== 'empty',
            )
            .map(item => `${item.source}: ${item.status}`),
        },
      ],
    },
    sources: references,
    sourceStatus: 'current' as const,
  };
}
