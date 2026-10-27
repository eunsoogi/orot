import type {
  EvidenceBatch,
  EvidenceSearchTool,
  EvidenceReference,
} from '@orot/agent-runtime';
import type { AiFeatureLocalData } from '../../aiFeatures/integration/localData';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { toolsFor } from '../../aiFeatures/integration/featureServiceExecution';
import type { HealthReviewEvidence } from './port';
import { parseHealthContextScope } from '../../healthEvidence/healthContext/scope';
import { registerHealthContextEvidence } from '../../aiFeatures/integration/healthContextEvidence';

/** Empty aggregate receipts describe unknown coverage, not observations sufficient for a review. */
function hasTrendObservations(batch: EvidenceBatch): boolean {
  return batch.items.some(item => {
    if (!item.content.startsWith('health_context: ')) return false;
    try {
      const value = JSON.parse(item.content.slice('health_context: '.length));
      return (
        (Array.isArray(value.quantities) &&
          value.quantities.some(
            (series: { sampleCount?: number }) =>
              typeof series.sampleCount === 'number' && series.sampleCount > 0,
          )) ||
        (typeof value.symptoms?.entryCount === 'number' &&
          value.symptoms.entryCount > 0)
      );
    } catch {
      return false;
    }
  });
}

/** The existing local tool implementations own SQL selection, projection, redaction and freshness. */
export function createHealthReviewEvidence(
  data: AiFeatureLocalData,
  registry = new LocalEvidenceReferenceRegistry(),
): HealthReviewEvidence | undefined {
  const tools = toolsFor(undefined, data, registry, 4, true);
  const trends = tools.find(tool => tool.id === 'local-health-context');
  const records = tools.find(tool => tool.id === 'local-personal-records');
  if (!trends || !records) return undefined;
  let restored: readonly EvidenceReference[] = [];
  const guardedTrends: EvidenceSearchTool = {
    ...trends,
    async search(request, runtime) {
      const periods = restored
        .map(reference => parseHealthContextScope(reference.locator))
        .filter(scope => scope !== undefined);
      let result;
      if (periods.length) {
        // Whole-period restoration must retain the original tool's pre-read authorization fence.
        if (
          !request.allowedScope.sourceKinds.includes('personal_record') ||
          request.allowedScope.sourceIds ||
          request.allowedScope.timeRange
        )
          return {
            items: [],
            conflicts: [],
            coverage: [
              {
                sourceKind: 'personal_record',
                searchedSourceIds: [],
                gaps: [
                  'period_context_requires_unrestricted_personal_record_scope_use_scoped_raw_search',
                ],
                truncated: false,
                resultLimit: request.resultLimit,
                returnedCount: 0,
              },
            ],
          };
        if (request.signal.aborted)
          throw new Error('Health context restoration cancelled.');
        if (!data.readHealthContext || periods.length > request.resultLimit)
          throw new Error('Saved health period unavailable.');
        const read = data.readHealthContext;
        const items = [];
        for (const scope of periods) {
          // Re-read the exact saved endpoints, never a new relative 30-day window after restart.
          const report = await read(
            scope.window,
            [scope.topic],
            request.signal,
          );
          items.push(
            registerHealthContextEvidence({
              registry,
              read,
              report,
              scope,
              detail: 'weekly',
            }),
          );
        }
        result = {
          items,
          conflicts: [],
          coverage: [
            {
              sourceKind: 'personal_record' as const,
              searchedSourceIds: items.map(item => item.sourceId),
              gaps: [],
              truncated: false,
              resultLimit: request.resultLimit,
              returnedCount: items.length,
            },
          ],
        };
      } else result = await trends.search(request, runtime);
      if ('status' in result || hasTrendObservations(result)) return result;
      return {
        ...result,
        coverage: result.coverage.map(coverage => ({
          ...coverage,
          gaps: [...coverage.gaps, 'health_trends_require_observations'],
        })),
      };
    },
  };
  return {
    restore: references => {
      restored = references;
    },
    trends: guardedTrends,
    records,
    resolve: reference => registry.resolve(reference),
    revalidate: (references, signal) =>
      registry.revalidateEvidence(references, signal),
  };
}
