import type { Appointment } from '@orot/domain';
import type { RecordKind } from '@orot/storage';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { NextVisitQuestionsRoute } from '../src/aiFeatures/integration/NextVisitQuestionsRoute';
import type { VisitQuestionsRenderInput } from '../src/aiFeatures/integration/AiFeatureFlowScreen';
import { defaultVisitQuestionRouteOperations } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../src/storage/secureDatabase';
import { auditVisitQuestionScope } from './visitQuestionScopeAudit';
import {
  beginScopeObservation,
  dispatchScoped,
  expectedEvent,
  expectedSymptom,
  observedEvidenceCount,
  providerEvidenceCount,
  requireScopeContext,
} from './visitQuestionScopeGuard';
const otherKinds: readonly RecordKind[] = [
  'source_record',
  'evidence_span',
  'encounter',
  'health_observation',
  'medication_definition',
  'medication_assertion',
  'dose_event',
  'transcript_segment',
];

async function audit(selected: Appointment) {
  const repository = await openLocalStorage();
  const database = await openLocalAgentMemoryDatabase();
  const [appointments, symptoms, ...others] = await Promise.all([
    repository.list('appointment'),
    repository.list('symptom_entry'),
    ...otherKinds.map(kind => repository.list(kind)),
  ]);
  const tables = await database.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('manual_history_entries', 'agent_memory_records')",
  );
  const names = new Set(tables.rows.map(row => row.name));
  const manual = names.has('manual_history_entries')
    ? await database.execute('SELECT id FROM manual_history_entries')
    : { rows: [] };
  const memory = names.has('agent_memory_records')
    ? await database.execute('SELECT record_json FROM agent_memory_records')
    : { rows: [] };
  const memorySourceIds = memory.rows.map(row => {
    if (typeof row.record_json !== 'string') return [];
    try {
      const sources: unknown = JSON.parse(row.record_json).meta?.provenance
        ?.sourceIds;
      return Array.isArray(sources) &&
        sources.every(id => typeof id === 'string')
        ? (sources as string[])
        : [];
    } catch {
      return [];
    }
  });
  return auditVisitQuestionScope(
    {
      appointments,
      symptomIds: symptoms.map(item => item.id),
      otherCounts: Object.fromEntries([
        ...otherKinds.map((kind, index) => [kind, others[index]!.length]),
        ['manual_history', manual.rows.length],
      ]),
      memorySourceIds,
    },
    selected,
    expectedEvent,
    expectedSymptom,
  );
}

/** Test-only gate checks all reachable local sources before every real provider dispatch. */
export function visitQuestionScopeDiagnostics(report: (value: string) => void) {
  const operations = {
    ...defaultVisitQuestionRouteOperations,
    async generate(
      input: Parameters<typeof defaultVisitQuestionRouteOperations.generate>[0],
    ) {
      let calls = 0;
      const token = beginScopeObservation(report);
      const check = async (requireContext = false) => {
        if (requireContext) requireScopeContext(token);
        const result = await audit(input.appointment);
        report(
          JSON.stringify({
            ...result,
            calls,
            validatedEvidence: observedEvidenceCount(token),
          }),
        );
        if (!result.ok)
          throw new Error('Synthetic evidence scope is not confirmed.');
      };
      await check();
      const original = input.selectedAi.option.provider;
      if (
        original.id !== 'apple-foundation-models' ||
        input.selectedAi.remoteProcessing
      )
        throw new Error(
          'The selected provider is not the on-device fixture target.',
        );
      const provider: LanguageModelProvider = {
        ...original,
        async generate(...args) {
          return dispatchScoped(
            token,
            () => check(true),
            () => {
              const payloadEvidence = providerEvidenceCount(token, args[0]);
              report(
                JSON.stringify({
                  calls,
                  validatedEvidence: observedEvidenceCount(token),
                  payloadEvidence,
                }),
              );
              calls += 1;
              return original.generate(...args);
            },
          );
        },
        ...(original.stream
          ? {
              async *stream(
                ...args: Parameters<
                  NonNullable<LanguageModelProvider['stream']>
                >
              ) {
                await check(true);
                requireScopeContext(token);
                const payloadEvidence = providerEvidenceCount(token, args[0]);
                report(
                  JSON.stringify({
                    calls,
                    validatedEvidence: observedEvidenceCount(token),
                    payloadEvidence,
                  }),
                );
                calls += 1;
                yield* original.stream!(...args);
              },
            }
          : {}),
      };
      const result = await defaultVisitQuestionRouteOperations.generate({
        ...input,
        selectedAi: {
          ...input.selectedAi,
          provider,
          option: { ...input.selectedAi.option, provider },
        },
      });
      report(
        JSON.stringify({
          ...(await audit(input.appointment)),
          calls,
          validatedEvidence: observedEvidenceCount(token),
          outcome: result.status,
        }),
      );
      return result;
    },
  };
  return (input: VisitQuestionsRenderInput) => (
    <NextVisitQuestionsRoute {...input} operations={operations} />
  );
}
