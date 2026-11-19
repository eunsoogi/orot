import { persistDailyReportCandidate } from './dailyReportCandidatePersistence';
import { conversationReceiptSelection as observeSelection } from './conversationReceiptSelection';
import { withDailyReportOpening as openingFor } from './dailyReportOpening';
import { hasSevereReportBloodPressure } from './dailyReportGuidance';
import { reportModelClaims } from './dailyReportModelAnalysis';
import { prepareDailyReportFacts } from './dailyReportPreparedFacts';
import type { prepareReportCalendar } from './dailyReportSystemCalendar';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { providerDiagnostic } from '../../providers/diagnostics';
import { validateDailyReportCompletion } from '../../storage/dailyReportValidation';
import {
  resolveSelectedAiProvider as resolveAi,
  type SelectedAiResolution,
} from './provider';
import { dailyReportFacts } from './dailyReportFacts';
import { dailyReportAnalysis } from './dailyReportAnalysis';
import { selectDailyReportFacts } from './dailyReportModel';
import { stableJson } from './evidenceUtils';
import { dailyReportProviderFacts } from './dailyReportProjection';
import { reportFailureOutcome as failureOutcome } from './dailyReportFailureDiagnostics';
import type {
  DailyReportFailureCode,
  DailyReportRunInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';
type ReadyCalendar = Extract<
  ReturnType<typeof createDailyReportCalendarWindow>,
  { status: 'ready' }
>;
/** Reads the day's evidence, validates the selected model result, and saves one report revision. */
export async function generateDailyReportWithCalendar(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
  calendar: ReadyCalendar,
  external?: Awaited<ReturnType<typeof prepareReportCalendar>>,
) {
  const fail = (code: DailyReportFailureCode) => {
    // The deadline already reports the active stage; do not add a second cause for its abort.
    if (!input.deadlineContext.timedOut)
      providerDiagnostic('daily_report', 'workflow', failureOutcome(code));
    return { status: 'failed' as const, code };
  };
  input.deadlineContext.stage = 'provider_selection';
  providerDiagnostic('daily_report', 'selection', 'started');
  let selected: SelectedAiResolution;
  try {
    selected = observeSelection(
      await (input.resolveSelected ?? resolveAi)(),
      request.observer,
    );
  } catch {
    if (request.signal.aborted) return fail('cancelled');
    providerDiagnostic('daily_report', 'selection', 'unavailable');
    return fail('provider_unavailable');
  }
  if (request.signal.aborted) return fail('cancelled');
  input.deadlineContext.stage = 'workflow';
  if (selected.status !== 'ready') {
    providerDiagnostic('daily_report', 'selection', 'unavailable');
    return fail('provider_unavailable');
  }
  providerDiagnostic('daily_report', 'selection', 'completed');
  type Snapshot = Awaited<
    ReturnType<NonNullable<typeof input.data.readDailyReportSnapshot>>
  >;
  let snapshot: Snapshot;
  let facts: ReturnType<typeof dailyReportFacts>;
  let providerFacts: Awaited<ReturnType<typeof dailyReportProviderFacts>>;
  let sourceSnapshot: Snapshot['sourceSnapshot'];
  let required: number[];
  let factSourceIndexes: number[][];
  let baselineFacts: ReturnType<typeof dailyReportFacts> = [];
  let sleepFacts: ReturnType<typeof dailyReportFacts> = [];
  input.deadlineContext.stage = 'source_read';
  providerDiagnostic('daily_report', 'data', 'started');
  try {
    snapshot = await input.data.readDailyReportSnapshot!(
      calendar.context,
      request.scope,
      request.signal,
    );
    // Keep an empty successful read distinct from a database failure and never prompt without facts.
    if (!snapshot.values.length) {
      providerDiagnostic('daily_report', 'data', 'unavailable');
      return fail('source_unavailable');
    }
    ({
      required,
      factSourceIndexes,
      sourceSnapshot,
      facts,
      providerFacts,
      baselineFacts,
      sleepFacts,
    } = await prepareDailyReportFacts(
      input,
      request,
      calendar,
      snapshot,
      external,
    ));
  } catch {
    if (request.signal.aborted) return fail('cancelled');
    providerDiagnostic('daily_report', 'data', 'failed');
    return fail('source_read_failed');
  }
  providerDiagnostic('daily_report', 'data', 'completed');
  input.deadlineContext.stage = 'workflow';
  const context = createDailyReportContext(
    calendar.context,
    sourceSnapshot,
    {
      providerId: selected.provider.id,
      modelId: selected.modelId,
    },
    external?.binding,
  );
  const runId = input.createRunId();
  const selection = await openingFor(
    input,
    request,
    selected,
    !!external?.facts.length,
    consent =>
      selectDailyReportFacts({
        selected,
        consent,
        runId,
        facts: providerFacts,
        allowAnalysis: !hasSevereReportBloodPressure(snapshot.values),
        reportContext: {
          localDate: calendar.context.identity.localDate,
          timeZone: calendar.context.identity.timeZone,
          generationCutoff: calendar.context.generationCutoff,
          coverage: sourceSnapshot.coverage,
        },
        includesSystemCalendar: !!external?.facts.length,
        signal: request.signal,
        timeoutMs: input.timeoutMs ?? null,
        deadlineContext: input.deadlineContext,
        revalidate: async signal => {
          input.deadlineContext.stage = 'source_read';
          providerDiagnostic('daily_report', 'data', 'started');
          let current: Snapshot;
          try {
            current = await input.data.readDailyReportSnapshot!(
              calendar.context,
              request.scope,
              signal,
            );
          } catch (error) {
            if (!signal.aborted)
              providerDiagnostic('daily_report', 'data', 'failed');
            throw error;
          }
          providerDiagnostic('daily_report', 'data', 'completed');
          input.deadlineContext.stage = 'workflow';
          return (
            (external ? await external.snapshot.revalidate() : true) &&
            stableJson(current.sourceSnapshot) ===
              stableJson(snapshot.sourceSnapshot)
          );
        },
      }),
  );
  input.deadlineContext.stage = 'workflow';
  if (selection.status === 'failed') return fail(selection.code);
  const report = {
    schemaVersion: 1 as const,
    identity: context.identity,
    generatedAt: input.now(),
    observations: [...new Set([...required, ...selection.indexes])]
      .slice(0, 8)
      .map(index => ({
        text: facts[index]!.text,
        sourceReferences: facts[index]!.sourceReferences,
      })),
    supportedContext: dailyReportAnalysis(
      snapshot.values,
      snapshot.sourceSnapshot.records.slice(0, snapshot.values.length),
      selection.indexes.flatMap(index => factSourceIndexes[index] ?? []),
      baselineFacts,
      external?.facts ?? [],
      reportModelClaims(selection.analysis, facts),
      sleepFacts,
    ),
    coverage: context.sourceSnapshot.coverage,
    followUpQuestions: [],
  };
  const result = { status: 'completed' as const, report };
  input.deadlineContext.stage = 'validation';
  providerDiagnostic('daily_report', 'validation', 'started');
  if (!validateDailyReportCompletion(context, result)) {
    providerDiagnostic('daily_report', 'validation', 'invalid_output');
    return fail('malformed_output');
  }
  providerDiagnostic('daily_report', 'validation', 'completed');
  if (request.signal.aborted) return fail('cancelled');
  input.deadlineContext.stage = 'save';
  providerDiagnostic('daily_report', 'persistence', 'started');
  const candidate = {
    runId,
    context,
    result,
    lineage: snapshot.lineage,
    mode:
      request.mode.kind === 'revise'
        ? request.mode
        : { kind: 'initial' as const },
  };
  const saved = await persistDailyReportCandidate(
    input,
    candidate,
    calendar.context,
    request.signal,
  );
  if (saved.status === 'failed') return fail(saved.code);
  if (external && !(await external.snapshot.revalidate())) {
    await input.storage.lookup(context.identity);
    return fail('source_revision_changed');
  }
  providerDiagnostic('daily_report', 'persistence', 'completed');
  providerDiagnostic('daily_report', 'workflow', 'result');
  return { status: 'completed' as const, runId, context, report };
}
