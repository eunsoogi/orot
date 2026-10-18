import { openAiFeatureLocalData } from '../src/aiFeatures/integration/localData';
import type { AiFeatureLocalData } from '../src/aiFeatures/integration/localData';
import type {
  AiFeatureServiceDependencies,
  AiFeatureServices,
} from '../src/aiFeatures/integration/featureServices';
import { runRagConversationTurn } from '../src/ragConversation/service';
import type { RagConversationOutcome } from '../src/ragConversation/service';

export const PERFORMANCE_RAG_QUESTION =
  '최근 합성 심박수 기록을 찾아 날짜와 수치를 요약해 주세요.';

type DiagnosticProviderSelection =
  | {
      readonly status: 'ready';
      readonly provider: { readonly id: string };
      readonly remoteProcessing: boolean;
    }
  | { readonly status: 'selection-required' | 'unavailable' };

export type PerformanceRagQuestionResult =
  | {
      readonly status: 'completed';
      readonly question: string;
      readonly outcome: RagConversationOutcome;
    }
  | {
      readonly status: 'skipped';
      readonly reason: 'on_device_apple_provider_not_selected';
    };

export interface PerformanceRagTraceEntry {
  readonly stage: string;
  readonly value: unknown;
}

export interface PerformanceRagDiagnosticDependencies extends AiFeatureServiceDependencies {
  getTrace(): readonly PerformanceRagTraceEntry[];
}

/** Runs the fixed synthetic question through the same service method as the chat screen. */
export async function runPerformanceRagQuestion(
  selection: DiagnosticProviderSelection,
  services: Pick<AiFeatureServices, 'sendRagMessage'>,
  signal: AbortSignal,
): Promise<PerformanceRagQuestionResult> {
  if (
    selection.status !== 'ready' ||
    selection.provider.id !== 'apple-foundation-models' ||
    selection.remoteProcessing
  )
    return {
      status: 'skipped',
      reason: 'on_device_apple_provider_not_selected',
    };

  return {
    status: 'completed',
    question: PERFORMANCE_RAG_QUESTION,
    outcome: await services.sendRagMessage(
      PERFORMANCE_RAG_QUESTION,
      [],
      signal,
    ),
  };
}

/** Synthetic performance entry only. Observe unchanged queries, candidates, ranks and
 * selected content; never import this payload logger from the shipping entry. */
export function performanceRagDiagnostics(): PerformanceRagDiagnosticDependencies {
  // Preserve the production object's cache identity across turns and retries.
  const observed = new WeakMap<AiFeatureLocalData, AiFeatureLocalData>();
  const traceEntries: PerformanceRagTraceEntry[] = [];
  const trace = (stage: string, value: unknown) => {
    traceEntries.push({ stage, value });
    console.info(
      'OROT_SYNTHETIC_RAG_TRACE ' + JSON.stringify({ stage, value }),
    );
  };
  return {
    getTrace() {
      return traceEntries.map(entry => ({ ...entry }));
    },
    async loadLocalData() {
      const data = await openAiFeatureLocalData();
      const cached = observed.get(data);
      if (cached) return cached;
      const wrapped: AiFeatureLocalData = {
        ...data,
        async readCandidates(...args) {
          const result = await data.readCandidates(...args);
          trace('candidates', {
            query: args[0],
            records: result.candidates.map(({ kind, record }) => ({
              kind,
              id: record.id,
              effectiveAt: record.effectiveAt,
              concept: 'concept' in record ? record.concept : undefined,
            })),
          });
          return result;
        },
        rag: {
          index: (...args) => data.rag.index(...args),
          async search(...args) {
            const hits = await data.rag.search(...args);
            trace('ranked', {
              query: args[0],
              limit: args[2],
              hits: hits.map(hit => ({
                kind: hit.chunk.metadata.recordType,
                id: hit.chunk.metadata.evidenceId,
                score: hit.score,
                lexicalRank: hit.lexicalRank,
                vectorRank: hit.vectorRank,
                text: hit.chunk.text.slice(0, 1000),
              })),
            });
            return hits;
          },
        },
      };
      observed.set(data, wrapped);
      return wrapped;
    },
    async ragRunner(options, invocation) {
      trace('question', options.question);
      const tools = options.workflow.tools.map(tool => ({
        ...tool,
        async search(...args: Parameters<typeof tool.search>) {
          const result = await tool.search(...args);
          trace('selected', { tool: tool.id, input: args[0].input, result });
          return result;
        },
      }));
      const outcome = await runRagConversationTurn(
        { ...options, workflow: { ...options.workflow, tools } },
        invocation,
      );
      trace('outcome', outcome);
      return outcome;
    },
  };
}
