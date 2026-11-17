import { createManualHistoryRepository } from '@orot/storage';
import { validateDailyReportArtifact } from './dailyReportArtifactValidation';
import type { SqlExecutor } from '@orot/storage';
import type { PersistedMemoryRecord } from '@orot/agent-memory';
import { decodeResearchArtifact } from './researchArtifactCodec';
import { legacyResearchPeriodAvailable } from './legacyResearchPeriodQuarantine';
import { decodeSavedSymptomSummary } from './symptomSummaryStorageCodec';
import { legacySummaryPeriodAvailable } from './legacySummaryPeriodQuarantine';

/** Memory may open before its parent catalog. Inspect the exact serialized parent
 * instead of relying on that catalog having already installed policy rows. */
export async function directMemoryParentsAvailable(
  tx: SqlExecutor,
  record: PersistedMemoryRecord,
) {
  const ids = (record.meta.provenance as { sourceIds?: unknown } | undefined)
    ?.sourceIds;
  if (!Array.isArray(ids)) return true;
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    if (id.startsWith('generated-artifact:generated_research:')) {
      const key = id.slice('generated-artifact:generated_research:'.length);
      const match = /^research-([1-9][0-9]*)$/u.exec(key);
      if (!match) return false;
      const tables = await tx.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('research_artifacts')",
      );
      if (!tables.rows.length) return false;
      const row = (
        await tx.execute(
          'SELECT snapshot_json FROM research_artifacts WHERE id=?',
          [Number(match[1])],
        )
      ).rows[0];
      const parent = decodeResearchArtifact(
        Number(match[1]),
        row?.snapshot_json,
      );
      if (!parent || !(await legacyResearchPeriodAvailable(tx, parent)))
        return false;
    } else if (id.startsWith('generated-artifact:generated_summary:')) {
      const key = id.slice('generated-artifact:generated_summary:'.length);
      const tables = await tx.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('symptom_summary_runs')",
      );
      if (!tables.rows.length) return false;
      const row = (
        await tx.execute(
          'SELECT result_json FROM symptom_summary_runs WHERE id=?',
          [key],
        )
      ).rows[0];
      const parent = decodeSavedSymptomSummary(row?.result_json);
      if (parent) {
        if (!(await legacySummaryPeriodAvailable(tx, parent))) return false;
      } else {
        // Daily reports share the generated_summary identity but use individual
        // record lineage, not legacy aggregate policy. Bind reads to this same tx.
        const history = createManualHistoryRepository({
          execute: (query, args) => tx.execute(query, args),
          transaction: async () => {
            throw new Error('Nested parent validation is unavailable.');
          },
        });
        if (!(await validateDailyReportArtifact(tx, key, history, true)))
          return false;
      }
    }
  }
  return true;
}
