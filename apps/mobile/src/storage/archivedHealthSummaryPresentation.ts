import type { SqlExecutor } from '@orot/storage';
import type {
  HealthSummaryReference,
  HealthSummaryResult,
} from '../ragConversation/healthSummary';
import {
  fingerprint,
  stableJson,
} from '../aiFeatures/integration/evidenceUtils';
import {
  isPeriodSummarySource,
  type SavedSymptomSummary,
} from '../diseaseHypotheses/savedSummaries';
import { parseHealthSummaryReference } from '../ragConversation/healthSummary';
import { projectSavedArchivedCitations } from '../ragConversation/savedArchivedCitations';
import { visibleSummary } from './symptomSummaryQuarantine';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';

export type ArchivedHealthSummaryOwner = {
  readonly conversationId: string;
  readonly reference: HealthSummaryReference;
  readonly providerId: unknown;
  readonly modelId: unknown;
};

export function archivedHealthSummaryOwner(
  conversationId: string,
  value: Record<string, unknown>,
): ArchivedHealthSummaryOwner | undefined {
  if (value.status !== 'complete') return;
  const reference = parseHealthSummaryReference(value.healthSummary);
  if (reference)
    return {
      conversationId,
      reference,
      providerId: value.providerId,
      modelId: value.modelId,
    };
}

/** Load only the matching authoritative saved summaries inside the admitted archive transaction. */
async function readOwnedArchivedSummaries(
  tx: SqlExecutor,
  owners: readonly ArchivedHealthSummaryOwner[],
) {
  const results = new Map<
    string,
    { summary: SavedSymptomSummary; sourceChanged: boolean }
  >();
  if (!owners.length) return results;
  const schema = await tx.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'summary_period_policy'",
  );
  // Do not start summary migration or a legacy recheck merely to draw chat.
  if (!schema.rows.length) return results;
  const { rows } = await tx.execute(
    `SELECT r.id, r.result_json,
     EXISTS (SELECT 1 FROM conversation_invalid_summaries x WHERE x.id = r.id) AS source_changed
     FROM symptom_summary_runs r
     JOIN summary_period_policy p ON p.summary_id = r.id AND p.status = 'current'
     JOIN json_each(?) i ON i.value = r.id
     WHERE ${visibleSummary}`,
    [
      JSON.stringify([
        ...new Set(owners.map(owner => owner.reference.summaryId)),
      ]),
    ],
  );
  const saved = new Map(
    rows.map(row => [
      row.id,
      {
        summary: decodeSavedSymptomSummary(row.result_json),
        sourceChanged: row.source_changed === 1,
      },
    ]),
  );
  for (const owner of owners) {
    const { reference } = owner;
    const record = saved.get(reference.summaryId);
    const summary = record?.summary;
    if (
      !summary ||
      summary.id !== reference.summaryId ||
      summary.providerId !== owner.providerId ||
      summary.modelId !== owner.modelId ||
      summary.inputLineage !== 'complete' ||
      summary.analysis.presentation !== 'symptom_summary'
    )
      continue;
    const matchingWindow = stableJson(reference.window);
    const periods = summary.sources.filter(isPeriodSummarySource);
    if (
      !periods.length ||
      periods.some(source => stableJson(source.scope.window) !== matchingWindow)
    )
      continue;
    results.set(owner.conversationId, {
      summary,
      sourceChanged: record.sourceChanged,
    });
  }
  return results;
}

const sectionReferences = (
  section: SavedSymptomSummary['analysis']['hypotheses'][number],
) => [...section.supportingEvidence, ...section.contraryEvidence];

/** Project previously admitted text and inert section chips; no sources or aliases leave storage. */
export async function readArchivedHealthSummaryPresentation(
  tx: SqlExecutor,
  owners: readonly ArchivedHealthSummaryOwner[],
) {
  const saved = await readOwnedArchivedSummaries(tx, owners);
  const results = new Map<string, HealthSummaryResult>();
  for (const { conversationId, reference } of owners) {
    const record = saved.get(conversationId);
    if (!record) continue;
    const { summary, sourceChanged } = record;
    const { analysis } = summary;
    let offset = 0;
    const archivedSectionCitations = analysis.hypotheses.map(section => {
      const refs = sectionReferences(section);
      const metadata = projectSavedArchivedCitations(refs).map(citation => ({
        ...citation,
        ordinal: citation.ordinal + offset,
      }));
      offset += refs.length;
      return metadata;
    });
    results.set(conversationId, {
      reference,
      archivedSectionCitations,
      archivedSummaryRevision: fingerprint(summary),
      analysis: {
        presentation: 'symptom_summary',
        ...(analysis.omittedUnsupportedContent === true
          ? { omittedUnsupportedContent: true }
          : {}),
        ...(analysis.incompleteEvidence === true
          ? { incompleteEvidence: true }
          : {}),
        hypotheses: analysis.hypotheses.map(section => ({
          title: section.title,
          summary: section.summary,
          missingData: section.missingData,
          uncertainty: section.uncertainty,
          supportingEvidence: [],
          contraryEvidence: [],
        })),
        savedSummary: {
          status: 'saved',
          id: summary.id,
          createdAt: summary.createdAt,
          modelName: summary.modelName,
          ...(sourceChanged ? { sourceChanged: true } : {}),
        },
      },
    });
  }
  return results;
}

/** A pressed ordinal selects one exact source from the saved summary, not a live alias. */
export async function selectArchivedHealthSummaryCitation(
  tx: SqlExecutor,
  owner: ArchivedHealthSummaryOwner,
  ordinal: number,
  revision: string,
) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) return null;
  const summary = (await readOwnedArchivedSummaries(tx, [owner])).get(
    owner.conversationId,
  )?.summary;
  if (!summary || fingerprint(summary) !== revision) return null;
  const selected =
    summary.analysis.hypotheses.flatMap(sectionReferences)[ordinal];
  if (!selected) return null;
  const key = stableJson(selected);
  const matches = summary.sources.filter(
    source =>
      source.reference.evidenceId === selected.evidenceId &&
      source.reference.sourceId === selected.sourceId &&
      stableJson(source.reference) === key,
  );
  return matches.length === 1 ? matches[0]! : null;
}
