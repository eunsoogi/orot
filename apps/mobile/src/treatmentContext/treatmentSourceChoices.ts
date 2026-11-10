import { HealthObservationSchema } from '@orot/domain';
import type { EvidenceReference } from '@orot/agent-runtime';
import { createManualHistoryRepository, type SqlDatabase } from '@orot/storage';
import {
  fingerprint,
  stableJson,
} from '../aiFeatures/integration/evidenceUtils';
import { savedManualHistorySource } from '../aiFeatures/integration/manualHistoryEvidence';
import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import { assertRetainedEvidenceCurrent } from '../storage/retainedEvidenceFreshness';
import { createSymptomSummaryStorage } from '../storage/symptomSummaryStorage';
import { t } from '../i18n';
import { assertTreatmentAttribution } from './attribution';
import type { TreatmentEvidenceRequest } from './interfaces';
import type { TreatmentCondition } from './types';
import { parseTreatmentContext } from './validation';

export interface TreatmentSourceChoice {
  readonly key: string;
  readonly label: string;
  readonly status: TreatmentCondition['status'];
  readonly request: TreatmentEvidenceRequest;
}

/** A choice binds the original reference and revision, with no authority from a display label. */
function reference(
  id: string,
  revision: string,
  locator: EvidenceReference['locator'],
): EvidenceReference {
  return {
    sourceKind: 'personal_record',
    sourceId: id,
    sourceRevision: revision,
    evidenceId: id,
    evidenceRevision: revision,
    locator,
    effectiveTime: null,
    reviewState: 'unknown',
  };
}

function choice(
  database: SqlDatabase,
  key: string,
  label: string,
  condition: TreatmentCondition,
  sources: readonly ConversationArtifactSource[],
): TreatmentSourceChoice {
  const context = {
    version: 1 as const,
    conditions: [condition],
    clinicianPlans: { status: 'unavailable' as const },
    publicEvidence: [],
    missingContext: [],
    conflicts: [],
  };
  return {
    key,
    label,
    status: condition.status,
    request: {
      context,
      sources,
      async revalidateEvidence(references, signal) {
        if (
          signal.aborted ||
          !references.every(ref =>
            sources.some(
              source => stableJson(ref) === stableJson(source.reference),
            ),
          )
        )
          return false;
        try {
          await database.transaction(async tx => {
            const history = createManualHistoryRepository(database);
            await assertRetainedEvidenceCurrent(tx, sources, history, false);
            await assertTreatmentAttribution(tx, history, context, sources);
          });
          return !signal.aborted;
        } catch {
          return false;
        }
      },
    },
  };
}

async function recordChoices(database: SqlDatabase) {
  const history = createManualHistoryRepository(database);
  const entries = await history.list({ kind: 'diagnosis_history', limit: 10 });
  const result: TreatmentSourceChoice[] = [];
  const uncertainty = t('treatmentSafety.recordUncertainty');
  for (const entry of entries) {
    const evidence = await history.getEvidence(entry.id);
    if (evidence?.provenance.origin !== 'user_reported') continue;
    const record = savedManualHistorySource(evidence);
    const source = reference(record.id, record.revision, {
      kind: 'manual_history',
      entryId: record.id,
      effectiveDate: evidence.effectiveDate,
    });
    result.push(
      choice(
        database,
        `history:${record.id}`,
        entry.title,
        { status: 'user_reported', source, record, uncertainty },
        [{ reference: source, records: [record] }],
      ),
    );
  }
  const rows = await database.execute(
    "SELECT id, payload_json FROM health_observations WHERE json_valid(payload_json) AND json_extract(payload_json, '$.observationKind') = 'diagnosis' ORDER BY id DESC LIMIT 10",
  );
  for (const row of rows.rows) {
    if (typeof row.payload_json !== 'string') continue;
    const raw: unknown = JSON.parse(row.payload_json);
    const parsed = HealthObservationSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== row.id) continue;
    const observation = parsed.data;
    const status = observation.provenance.origin;
    if (status !== 'clinician_recorded' && status !== 'user_reported') continue;
    const record = {
      kind: 'health_observation' as const,
      id: observation.id,
      revision: fingerprint(raw),
    };
    const source = reference(record.id, record.revision, {
      kind: 'structured_record',
      recordId: record.id,
    });
    result.push(
      choice(
        database,
        `observation:${record.id}`,
        observation.concept,
        { status, source, record, uncertainty },
        [{ reference: source, records: [record] }],
      ),
    );
  }
  return result;
}

async function possibilityChoices(database: SqlDatabase) {
  const storage = createSymptomSummaryStorage(database);
  const choices: TreatmentSourceChoice[] = [];
  for (const item of await storage.list()) {
    const saved = await storage.readWithStatus(item.id);
    if (
      !saved ||
      saved.sourceChanged ||
      saved.summary.inputLineage !== 'complete' ||
      saved.summary.analysis.presentation
    )
      continue;
    const { summary } = saved;
    const revision = fingerprint(summary);
    const parent: ConversationArtifactSource = {
      kind: 'generated_summary',
      id: summary.id,
      revision,
      reference: {
        ...reference(summary.id, revision, {
          kind: 'generated_artifact',
          type: 'disease_possibilities',
        }),
        sourceKind: 'generated_artifact',
      },
    };
    for (const [index, hypothesis] of summary.analysis.hypotheses.entries()) {
      const {
        title,
        supportingEvidence,
        contraryEvidence,
        uncertainty,
        missingData,
      } = hypothesis;
      const refs = [...supportingEvidence, ...contraryEvidence];
      // Keep the summary as an invalidation dependency, never a clinical citation.
      const sources = refs.map(ref =>
        summary.sources.find(
          source => stableJson(source.reference) === stableJson(ref),
        ),
      );
      if (sources.some(source => !source) || sources.length >= 24) continue;
      choices.push(
        choice(
          database,
          `possibility:${summary.id}:${index}`,
          title,
          {
            status: 'ai_possibility',
            title,
            supportingEvidence,
            contraryEvidence,
            uncertainty,
            missingData,
          },
          [...sources.filter(source => source !== undefined), parent],
        ),
      );
    }
  }
  return choices;
}

/** Discover only complete, currently valid choices from local records and validated possibility runs. */
export async function listTreatmentSourceChoices(
  database: SqlDatabase,
  signal: AbortSignal,
) {
  const result = [
    ...(await recordChoices(database)),
    ...(await possibilityChoices(database)),
  ];
  const available: TreatmentSourceChoice[] = [];
  for (const candidate of result) {
    if (signal.aborted) return [];
    const { context, sources, revalidateEvidence } = candidate.request;
    if (
      parseTreatmentContext(context, sources) &&
      (await revalidateEvidence([], signal))
    )
      available.push(candidate);
  }
  return available;
}
