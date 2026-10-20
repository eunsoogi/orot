import type { EvidenceReference } from '@orot/agent-runtime';
import type { VisitQuestionHealthContextSource } from '@orot/domain';
import { createHealthContextTool } from '../../aiFeatures/integration/healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { registerHealthContextEvidence } from '../../aiFeatures/integration/healthContextEvidence';
import { completeVisitHealthContextFacts } from './healthContextFacts';
import {
  healthContextRevision,
  parseHealthContextScope,
} from '../../healthEvidence/healthContext/scope';
import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import type { VisitQuestionEvidenceMetadata } from './evidence';
import { visitQuestionCitationKey } from './evidence';
import type { VisitQuestionEvidenceItem } from './taskContract';

/** Adapt the shared bounded aggregation tool to visit provenance without exposing registry aliases as record IDs. */
export function createVisitHealthContext(
  read: HealthContextReader,
  metadata: Map<string, VisitQuestionEvidenceMetadata>,
) {
  const registry = new LocalEvidenceReferenceRegistry();
  const source = createHealthContextTool(read, registry, 'visit');
  const capture = async (
    reference: EvidenceReference,
    content: string,
    signal?: AbortSignal,
  ) => {
    const scope = parseHealthContextScope(reference.locator);
    if (!scope || reference.sourceKind !== 'personal_record') return undefined;
    const report = await read(scope.window, [scope.topic], signal);
    if (signal?.aborted) return undefined;
    if (
      healthContextRevision(scope, report) !== reference.evidenceRevision ||
      reference.sourceRevision !== reference.evidenceRevision
    )
      return undefined;
    const item = { ...reference, content };
    metadata.set(visitQuestionCitationKey(item), {
      sourceRecordIds: [],
      sourceRecordRevisions: [],
      sourceDates: [],
      healthContextSource: {
        scope,
        revision: reference.evidenceRevision,
        deletionGeneration: report.deletionGeneration,
      },
    });
    return { item, limitations: report.limitations };
  };
  return {
    tool: {
      ...source,
      async search(request: Parameters<typeof source.search>[0]) {
        const batch = await source.search(request);
        if ('status' in batch) return batch;
        const items: VisitQuestionEvidenceItem[] = [];
        const gaps = new Set<string>();
        let truncated = false;
        for (const item of batch.items) {
          if (request.signal.aborted)
            throw new Error('The health period read was cancelled.');
          const original = registry.resolve(item);
          const current =
            original && (await capture(original, item.content, request.signal));
          if (!current)
            throw new Error('The health period changed during retrieval.');
          items.push(current.item);
          // Reader caps and unsupported categories are real coverage gaps. Unknown future
          // diagnostics must not silently become user-facing claims about missing records.
          for (const limitation of current.limitations) {
            if (
              limitation === 'quantity_sensor_series_limit_reached' ||
              limitation === 'medication_catalog_limit_reached'
            ) {
              gaps.add(limitation);
              truncated = true;
            } else if (
              limitation ===
              'unsupported_sleep_categories_excluded_from_duration'
            )
              gaps.add(limitation);
          }
        }
        return {
          ...batch,
          items,
          coverage: batch.coverage.map(value => ({
            ...value,
            searchedSourceIds: items.map(item => item.sourceId),
            gaps: [...new Set([...value.gaps, ...gaps])],
            truncated: value.truncated || truncated,
          })),
        };
      },
    },
    async reload(reference: EvidenceReference) {
      const scope = parseHealthContextScope(reference.locator);
      if (!scope) return undefined;
      const report = await read(scope.window, [scope.topic]);
      if (healthContextRevision(scope, report) !== reference.evidenceRevision)
        return undefined;
      const registered = registerHealthContextEvidence({
        registry,
        read,
        scope,
        report,
      });
      const original = registry.resolve(registered);
      if (
        !original ||
        visitQuestionCitationKey({ ...original, content: '' }) !==
          visitQuestionCitationKey({ ...reference, content: '' })
      )
        return undefined;
      return (
        await capture(original, completeVisitHealthContextFacts(scope, report))
      )?.item;
    },
    async validate(sourceValue: VisitQuestionHealthContextSource) {
      const report = await read(sourceValue.scope.window, [
        sourceValue.scope.topic,
      ]);
      return (
        report.deletionGeneration === sourceValue.deletionGeneration &&
        healthContextRevision(sourceValue.scope, report) ===
          sourceValue.revision
      );
    },
  };
}
