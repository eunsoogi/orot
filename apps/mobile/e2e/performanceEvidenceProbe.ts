import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { createLocalEvidenceData } from '../src/healthEvidence/localEvidenceData';
import { openLocalAgentMemoryDatabase } from '../src/storage/secureDatabase';

/** Measures the shipping SQL path against synthetic scale data without recording payload content. */
export async function measurePerformanceEvidence() {
  const database = await openLocalAgentMemoryDatabase();
  let payloadRows = 0;
  let maximumPayloadPage = 0;
  const observe = (executor: SqlExecutor): SqlExecutor => ({
    async execute(query, parameters) {
      const result = await executor.execute(query, parameters);
      const rows = result.rows.filter(
        row => typeof row.payload_json === 'string',
      ).length;
      payloadRows += rows;
      maximumPayloadPage = Math.max(maximumPayloadPage, rows);
      return result;
    },
  });
  const measured: SqlDatabase = {
    ...observe(database),
    transaction: operation =>
      database.transaction(transaction =>
        operation({
          ...observe(transaction),
          commit: () => transaction.commit(),
          rollback: () => transaction.rollback(),
        }),
      ),
  };
  const data = createLocalEvidenceData(measured);
  const started = Date.now();
  const selection = await data.readCandidates('최근 심박수 변화');
  const searched = Date.now();
  const chunks = await data.loadCurrentChunks(
    selection.candidates.map(({ kind, record }) => ({ kind, id: record.id })),
  );
  const loaded = Date.now();
  await data.findIdentifiers(JSON.stringify(selection.candidates));
  return {
    storedRecords: selection.catalog.totalRecordCount,
    selectedRecords: selection.candidates.length,
    chunks: chunks.length,
    payloadRows,
    maximumPayloadPage,
    searchMs: searched - started,
    selectedReadMs: loaded - searched,
    identifierScanMs: Date.now() - loaded,
  };
}
