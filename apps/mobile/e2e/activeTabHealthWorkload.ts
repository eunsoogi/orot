import type { SqlDatabase } from '@orot/storage';
import { createHealthContextTool } from '../src/aiFeatures/integration/healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../src/aiFeatures/integration/evidenceRegistry';
import { createLocalEvidenceData } from '../src/healthEvidence/localEvidenceData';

export type WorkloadEvent =
  | 'transaction-requested'
  | 'transaction-admitted'
  | 'transaction-settled'
  | 'aggregate-requested'
  | 'aggregate-settled';

/** Runs the production local tool using a caller-owned synthetic database.
 * The caller owns the connection, fixture isolation, and disposal. */
export async function runActiveTabHealthWorkload(
  database: SqlDatabase,
  window: { fromInclusive: string; toExclusive: string; timeZone: string },
  signal: AbortSignal,
  observe?: (event: WorkloadEvent) => void,
): Promise<number> {
  const observed: SqlDatabase = {
    execute: (query, bindings) => database.execute(query, bindings),
    async transaction(operation) {
      observe?.('transaction-requested');
      try {
        await database.transaction(async tx => {
          observe?.('transaction-admitted');
          await operation({
            ...tx,
            async execute(query, bindings) {
              const aggregate =
                /\bWITH\s+(?:RECURSIVE\s+)?(?:days|calendar)\s*\(/i.test(query);
              if (aggregate) observe?.('aggregate-requested');
              try {
                // The test-only marker selects this one synthetic tool query for
                // native observation; the SQL body and parameters stay intact.
                const selected = aggregate
                  ? `/* orot-synthetic-active-tab */${query}`
                  : query;
                return await tx.execute(selected, bindings);
              } finally {
                if (aggregate) observe?.('aggregate-settled');
              }
            },
          });
        });
      } finally {
        observe?.('transaction-settled');
      }
    },
  };
  const data = createLocalEvidenceData(observed);
  const tool = createHealthContextTool(
    data.readHealthContext!,
    new LocalEvidenceReferenceRegistry(),
    'rag',
  );
  const result = await tool.search({
    input: { topics: ['measurements'], window },
    operationRunId: 'synthetic-active-tab',
    operationKey: 'synthetic-health-context',
    allowedScope: { sourceKinds: ['personal_record'] },
    resultLimit: 8,
    maxPayloadBytes: 1000000,
    executionLimits: 'unbounded',
    signal,
  });
  if ('status' in result)
    throw new Error('Synthetic health tool did not finish.');
  const content = result.items[0]?.content;
  if (!content?.startsWith('health_context: '))
    throw new Error('Synthetic health context is unavailable.');
  const report = JSON.parse(content.slice('health_context: '.length)) as {
    quantities: { concept: string; sampleCount: number }[];
  };
  const count =
    report.quantities.find(quantity => quantity.concept === 'heart_rate')
      ?.sampleCount ?? 0;
  // A native-only terminal record makes an incomplete trace fail closed.
  await database.execute('/* orot-synthetic-active-tab-complete */SELECT 1');
  return count;
}
