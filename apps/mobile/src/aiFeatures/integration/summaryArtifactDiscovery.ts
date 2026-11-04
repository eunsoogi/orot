import type { SqlDatabase } from '@orot/storage';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';
import type {
  SavedSymptomSummary,
  SymptomSummaryStorage,
} from '../../diseaseHypotheses/savedSummaries';
import type {
  ArtifactDiscovery,
  ArtifactMetadata,
} from '../../healthEvidence/artifactDiscovery';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { fingerprint } from './evidenceUtils';
import { restoreSymptomSummary } from './symptomSummarySources';

type SummaryMetadata = ArtifactMetadata & {
  readonly type: 'symptom_summary' | 'disease_possibilities';
  readonly inputLineage: 'complete' | 'unknown';
};

function metadata(saved: SavedSymptomSummary): SummaryMetadata {
  const summary = saved.analysis.presentation === 'symptom_summary';
  return {
    type: summary ? 'symptom_summary' : 'disease_possibilities',
    id: saved.id,
    originFeature: summary ? 'symptom_summary' : 'disease_hypotheses',
    originSession: null,
    createdAt: saved.createdAt,
    eventTime: null,
    revision: fingerprint(saved),
    providerId: saved.providerId,
    modelId: saved.modelId,
    completion: 'complete',
    review: 'unreviewed',
    inputLineage: saved.inputLineage ?? 'unknown',
  };
}

function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Artifact discovery was cancelled.');
}

/** Queries saved output in its authoritative store and revalidates dependencies on each detail read. */
export function createSummaryArtifactDiscovery(input: {
  readonly database: SqlDatabase;
  readonly storage: SymptomSummaryStorage;
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
}): ArtifactDiscovery<SummaryMetadata, DiseaseHypothesisAnalysis> {
  return {
    async search({ query, cursor, limit, signal }) {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 20 ||
        query.length > 240 ||
        (cursor !== undefined && cursor.length > 512)
      )
        throw new RangeError('Invalid artifact search request.');
      checkCancelled(signal);
      // The existing store owns table creation and lifecycle triggers, including old databases.
      await input.storage.list();
      const result = await input.database.execute(
        `SELECT id FROM symptom_summary_runs AS run
         WHERE (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`,
        [cursor ?? null, cursor ?? null, limit + 1],
      );
      checkCancelled(signal);
      const rows = result.rows.slice(0, limit);
      const items: SummaryMetadata[] = [];
      let unavailableCount = 0;
      const needle = query.trim().normalize('NFKC').toLowerCase();
      for (const row of rows) {
        if (typeof row.id !== 'string')
          throw new Error('Invalid saved artifact identity.');
        const saved = await input.storage.read(row.id);
        // Corrupt, unsupported or concurrently deleted rows stay visible as coverage gaps.
        if (!saved) {
          unavailableCount += 1;
          continue;
        }
        // Querying unknown-lineage prose would reveal whether a removed input appeared in it.
        if (saved.inputLineage !== 'complete') {
          if (needle) unavailableCount += 1;
          else items.push(metadata(saved));
          continue;
        }
        const content = saved.analysis.hypotheses
          .flatMap(section => [
            section.title,
            section.summary,
            section.uncertainty,
            ...section.missingData,
          ])
          .join(' ')
          .normalize('NFKC')
          .toLowerCase();
        if (!needle || content.includes(needle)) items.push(metadata(saved));
      }
      checkCancelled(signal);
      return {
        items,
        nextCursor:
          result.rows.length > limit ? (rows.at(-1)?.id as string) : null,
        unavailableCount,
      };
    },
    async read(id, signal) {
      checkCancelled(signal);
      const saved = await input.storage.read(id);
      if (!saved) return null;
      // Older rows retained citations only; their uncited deleted inputs cannot be revalidated.
      if (saved.inputLineage !== 'complete') return null;
      const content = await restoreSymptomSummary(
        saved,
        input.registry,
        input.data,
      );
      checkCancelled(signal);
      // Source deletion can remove the artifact while its dependencies are being read.
      const current = await input.storage.read(id);
      checkCancelled(signal);
      if (!current) return null;
      if (fingerprint(current) !== fingerprint(saved))
        throw new Error('A saved artifact changed during detail read.');
      const changed =
        content.savedSummary?.status === 'saved' &&
        content.savedSummary.sourceChanged;
      return {
        metadata: metadata(saved),
        content,
        sources: saved.sources.map(source => source.reference),
        // External references are retained, but restoration does not establish current availability.
        sourceStatus: changed
          ? 'changed'
          : saved.sources.length === 0 ||
              saved.sources.some(
                source => source.reference.sourceKind === 'external_medical',
              )
            ? 'unknown'
            : 'current',
      };
    },
  };
}
