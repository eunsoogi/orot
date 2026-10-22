import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  createLocalRecordQueryRepository,
  createRecordRepository,
} from '@orot/storage';
import { createLocalEvidenceData } from '../src/healthEvidence/localEvidenceData';
import { HEALTH_CONTEXT_TOPICS } from '../src/healthEvidence/healthContext/types';
import { projectHealthContext } from '../src/healthEvidence/healthContext/projection';
import { recentHealthContextWindow } from '../src/healthEvidence/healthContext/window';
import { createBoundedVisitQuestionChunkBuilder } from '../src/agent/visitQuestions/boundedEvidenceChunks';
import { scaleEndAt } from './aiScaleSeed';

const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Observe the native/JS boundary without retaining payload content in diagnostics. */
export function measuredScaleDatabase(database: SqlDatabase) {
  const metrics = {
    sqlMs: 0,
    queries: 0,
    rows: 0,
    payloadRows: 0,
    maximumPayloadPage: 0,
  };
  const observe = (executor: SqlExecutor): SqlExecutor => ({
    async execute(query, parameters) {
      const start = performance.now();
      const result = await executor.execute(query, parameters);
      metrics.sqlMs += performance.now() - start;
      const elapsedMs = performance.now() - start;
      if (elapsedMs > 100)
        console.info(
          'OROT_AI_SCALE_SQL',
          JSON.stringify({
            operation: query.includes('WITH RECURSIVE positions')
              ? 'identifier-match'
              : query.includes('diversity_rank')
                ? 'candidate-ranking'
                : 'other',
            tables: [
              'health_observations',
              'appointments',
              'transcript_segments',
              'source_records',
              'dose_events',
              'symptom_entries',
            ].filter(table => query.includes(table)),
            elapsedMs,
            rows: result.rows.length,
          }),
        );
      metrics.queries += 1;
      metrics.rows += result.rows.length;
      const count = result.rows.filter(
        row => typeof row.payload_json === 'string',
      ).length;
      metrics.payloadRows += count;
      metrics.maximumPayloadPage = Math.max(metrics.maximumPayloadPage, count);
      return result;
    },
  });
  return {
    metrics,
    database: {
      ...observe(database),
      transaction: operation =>
        database.transaction(tx =>
          operation({
            ...observe(tx),
            commit: () => tx.commit(),
            rollback: () => tx.rollback(),
          }),
        ),
    } satisfies SqlDatabase,
  };
}

/** Shipping preparation and tool reads, excluding model generation and network latency. */
export async function measureAiScale(database: SqlDatabase) {
  const data = createLocalEvidenceData(database);
  const results: Record<string, unknown>[] = [];
  let stoppedAfterSlowStage: string | undefined;
  async function measure(name: string, operation: () => Promise<unknown>) {
    const start = performance.now();
    const output = await operation();
    results.push({
      name,
      elapsedMs: performance.now() - start,
      outputBytes: bytes(output),
    });
    console.info('OROT_AI_SCALE_STAGE', JSON.stringify(results.at(-1)));
    if (performance.now() - start > 4000) stoppedAfterSlowStage = name;
    return output;
  }
  const window = recentHealthContextWindow(90, scaleEndAt, 'UTC');
  const scaleStarted = performance.now();
  for (let run = 0; run < 6; run += 1) {
    await measure(
      `health-context-${run === 0 ? 'cold-adapter' : 'warm'}-${run}`,
      async () =>
        projectHealthContext(
          await data.readHealthContext!(window, HEALTH_CONTEXT_TOPICS),
        ),
    );
    if (stoppedAfterSlowStage) break;
    await measure(`conversation-search-${run}`, async () => {
      const selected = await data.readCandidates('최근 심박수 복용 전사 두통');
      if (selected.candidates.length > 64)
        throw new Error('Unbounded candidates');
      const chunks = await data.loadCurrentChunks(
        selected.candidates.map(({ kind, record }) => ({
          kind,
          id: record.id,
        })),
      );
      await data.findIdentifiers(chunks.map(chunk => chunk.text).join('\n'));
      return chunks;
    });
    if (stoppedAfterSlowStage) break;
    const builder = createBoundedVisitQuestionChunkBuilder(async () => data);
    await measure(`visit-evidence-${run}`, () =>
      builder(createRecordRepository(database), {
        query: '최근 심박수 복용 전사 두통',
      }),
    );
    if (stoppedAfterSlowStage) break;
    await measure(`next-appointment-${run}`, () =>
      createLocalRecordQueryRepository(
        database,
      ).queryNextConfirmedCalendarAppointment('2089-10-03T00:00:00Z'),
    );
    if (performance.now() - scaleStarted > 12000) {
      stoppedAfterSlowStage = 'scale-repetition-budget';
      break;
    }
  }
  const controller = new AbortController();
  controller.abort();
  let cancellationRejected = false;
  try {
    await data.readCandidates('cancelled', controller.signal);
  } catch {
    cancellationRejected = true;
  }
  return {
    results,
    cancellationRejected,
    stoppedAfterSlowStage: stoppedAfterSlowStage ?? null,
  };
}
