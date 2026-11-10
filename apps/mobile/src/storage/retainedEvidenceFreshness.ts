import {
  STORAGE_TABLES,
  type SqlExecutor,
  type ManualHistoryRepository,
} from '@orot/storage';
import type {
  SavedRecordSummarySource,
  SavedSummarySource,
} from '../diseaseHypotheses/savedSummaries';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import type {
  SavedGeneratedConversationSource,
  SavedGeneratedSummarySource,
} from '../diseaseHypotheses/savedSummaries';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { assertSummaryPeriodCurrent } from './symptomSummaryPeriods';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { readResearchArtifact } from './researchArtifactCodec';
import {
  assertSummarySourceAvailable,
  assertSymptomPeriodAvailable,
} from './symptomSummaryQuarantine';

interface Ancestry {
  readonly path: Set<string>;
  visited: number;
}

async function assertGeneratedSummaryCurrent(
  tx: SqlExecutor,
  source: SavedGeneratedSummarySource,
  manualHistory: ManualHistoryRepository,
  ancestry: Ancestry,
) {
  const key = `summary:${source.id}`;
  if (
    ancestry.path.has(key) ||
    ancestry.path.size >= 16 ||
    ++ancestry.visited > 128
  )
    throw new RetainedSourceInvalidError(
      'Generated artifact ancestry is cyclic or too large.',
    );
  ancestry.path.add(key);
  try {
    const invalid = await tx.execute(
      'SELECT id FROM conversation_invalid_summaries WHERE id = ? LIMIT 1',
      [source.id],
    );
    const result = await tx.execute(
      'SELECT result_json FROM symptom_summary_runs WHERE id = ? LIMIT 1',
      [source.id],
    );
    const parent = decodeSavedSymptomSummary(result.rows[0]?.result_json);
    const type =
      parent?.analysis.presentation === 'symptom_summary'
        ? 'symptom_summary'
        : 'disease_possibilities';
    if (
      invalid.rows.length ||
      !parent ||
      parent.inputLineage !== 'complete' ||
      fingerprint(parent) !== source.revision ||
      (source.reference.locator as { type?: unknown }).type !== type
    )
      throw new RetainedSourceInvalidError(
        'The generated summary changed or was removed.',
      );
    await assertRetainedEvidenceCurrent(
      tx,
      parent.sources,
      manualHistory,
      false,
      ancestry,
    );
  } finally {
    ancestry.path.delete(key);
  }
}

async function assertGeneratedConversationCurrent(
  tx: SqlExecutor,
  source: SavedGeneratedConversationSource,
  manualHistory: ManualHistoryRepository,
  ancestry: Ancestry,
) {
  const key = `conversation:${source.id}`;
  if (
    ancestry.path.has(key) ||
    ancestry.path.size >= 16 ||
    ++ancestry.visited > 128
  )
    throw new RetainedSourceInvalidError(
      'Generated artifact ancestry is cyclic or too large.',
    );
  ancestry.path.add(key);
  try {
    const result = await tx.execute(
      `SELECT a.result_json, a.id, a.session_id, a.created_at
       FROM conversation_artifacts a
       JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0
       JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
       WHERE a.id = ?
       AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents i WHERE i.id = a.id)
       AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)`,
      [source.id],
    );
    const row = result.rows[0];
    const parent = decodeConversationArtifact(row?.result_json);
    if (
      !parent ||
      parent.id !== row?.id ||
      parent.sessionId !== row?.session_id ||
      parent.createdAt !== row?.created_at ||
      parent.citations === undefined ||
      fingerprint(parent) !== source.revision
    )
      throw new RetainedSourceInvalidError(
        'The generated conversation changed or was removed.',
      );
    await assertRetainedEvidenceCurrent(
      tx,
      parent.sources,
      manualHistory,
      false,
      ancestry,
    );
  } finally {
    ancestry.path.delete(key);
  }
}

/** Validate source revisions in the same transaction as the derived output write. */
export async function assertRetainedEvidenceCurrent(
  tx: SqlExecutor,
  sources: readonly SavedSummarySource[],
  manualHistory: ManualHistoryRepository,
  requireGeneration = true,
  ancestry: Ancestry = { path: new Set(), visited: 0 },
) {
  for (const source of sources) {
    if (isPeriodSummarySource(source)) {
      await assertSymptomPeriodAvailable(tx, source);
      await assertSummaryPeriodCurrent(tx, source, requireGeneration);
      continue;
    }
    if ('kind' in source && source.kind === 'generated_summary') {
      await assertGeneratedSummaryCurrent(tx, source, manualHistory, ancestry);
      continue;
    }
    if ('kind' in source && source.kind === 'generated_conversation') {
      await assertGeneratedConversationCurrent(
        tx,
        source,
        manualHistory,
        ancestry,
      );
      continue;
    }
    if ('kind' in source && source.kind === 'generated_research') {
      const key = `research:${source.id}`;
      if (
        ancestry.path.has(key) ||
        ancestry.path.size >= 16 ||
        ++ancestry.visited > 128
      )
        throw new RetainedSourceInvalidError(
          'Generated artifact ancestry is cyclic or too large.',
        );
      ancestry.path.add(key);
      try {
        const item = await readResearchArtifact(tx, source.id);
        const type =
          item?.source.kind === 'publication'
            ? 'research_publication'
            : 'research_web_explanation';
        if (
          !item ||
          fingerprint(item) !== source.revision ||
          (source.reference.locator as { type?: unknown }).type !== type
        )
          throw new RetainedSourceInvalidError(
            'The saved research result changed or was removed.',
          );
        await assertRetainedEvidenceCurrent(
          tx,
          item.inputSources,
          manualHistory,
          false,
          ancestry,
        );
      } finally {
        ancestry.path.delete(key);
      }
      continue;
    }
    await assertRetainedRecordsCurrent(tx, source.records, manualHistory);
  }
}

/** Apply the same source and quarantine checks to non-summary artifacts. */
export async function assertRetainedRecordsCurrent(
  tx: SqlExecutor,
  records: SavedRecordSummarySource['records'],
  manualHistory: ManualHistoryRepository,
) {
  for (const record of records) {
    if (record.kind === 'manual_history') {
      const current = await manualHistory.getEvidence(record.id, tx);
      if (!current || fingerprint(current) !== record.revision)
        throw new RetainedSourceInvalidError(
          'A cited source changed before saving.',
        );
      continue;
    }
    const memory = record.kind === 'reviewed_memory';
    const table = memory
      ? 'agent_memory_records'
      : STORAGE_TABLES[record.kind].table;
    const column = memory ? 'record_json' : 'payload_json';
    const current = await tx.execute(
      `SELECT ${column} AS source_json FROM ${table} WHERE id = ?`,
      [record.id],
    );
    const serialized = current.rows[0]?.source_json;
    if (typeof serialized !== 'string')
      throw new RetainedSourceInvalidError(
        'A cited source was removed before saving.',
      );
    await assertSummarySourceAvailable(tx, record.kind, record.id, serialized);
    const parsed = JSON.parse(serialized);
    if (
      fingerprint(
        memory ? { text: parsed.text, meta: parsed.meta } : parsed,
      ) !== record.revision
    )
      throw new RetainedSourceInvalidError(
        'A cited source changed before saving.',
      );
    const stale = await tx.execute(
      'SELECT artifact_id FROM transcript_artifact_staleness WHERE artifact_kind = ? AND artifact_id = ? LIMIT 1',
      [record.kind, record.id],
    );
    if (stale.rows.length)
      throw new RetainedSourceInvalidError('A cited source is stale.');
  }
}
