import { dailyReportLiveCommit } from './dailyReportLiveCommit';
import { persistDailyReportCandidate } from './dailyReportCandidatePersistence';
import { selectDailyReportProvider } from './dailyReportProviderSelection';
import { withDailyReportOpening as openingFor } from './dailyReportOpening';
import { selectCurrentDailyReportFacts } from './dailyReportCurrentSelection';
import { reportModelClaims } from './dailyReportModelAnalysis';
import { prepareDailyReportFacts } from './dailyReportPreparedFacts';
import * as reportData from './dailyReportDataDiagnostics';
import type { prepareReportCalendar } from './dailyReportSystemCalendar';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import type { DailyReportCalendarResult } from '../../healthEvidence/healthContext/dailyReportWindow';
import { providerDiagnostic } from '../../providers/diagnostics';
import { validateDailyReportCompletion } from '../../storage/dailyReportValidation';
import { dailyReportFacts } from './dailyReportFacts';
import { dailyReportAnalysis, reportObservations } from './dailyReportAnalysis';
import { fingerprint } from './evidenceUtils';
import { reportFailureOutcome as failureOutcome } from './dailyReportFailureDiagnostics';
import type {
  DailyReportFailureCode,
  DailyReportRunInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';
export async function generateDailyReportWithCalendar(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
  calendar: Extract<DailyReportCalendarResult, { status: 'ready' }>,
  external?: Awaited<ReturnType<typeof prepareReportCalendar>>,
  providerSelection = () => selectDailyReportProvider(input, request),
) {
  const fail = (code: DailyReportFailureCode) => {
    if (!input.deadlineContext.timedOut)
      providerDiagnostic('daily_report', 'workflow', failureOutcome(code));
    return { status: 'failed' as const, code };
  };
  const resolved = await providerSelection();
  if (request.signal.aborted || resolved.status === 'cancelled')
    return fail('cancelled');
  if (resolved.status !== 'ready') return fail('provider_unavailable');
  let selected = resolved;
  type Snapshot = Awaited<
    ReturnType<NonNullable<typeof input.data.readDailyReportSnapshot>>
  >;
  let snapshot: Snapshot;
  let facts: ReturnType<typeof dailyReportFacts>;
  let providerFacts: Awaited<
    ReturnType<typeof prepareDailyReportFacts>
  >['providerFacts'];
  let sourceSnapshot: Snapshot['sourceSnapshot'];
  let required: number[];
  let factSourceIndexes: number[][];
  let baselineFacts: ReturnType<typeof dailyReportFacts> = [];
  let sleepFacts: ReturnType<typeof dailyReportFacts> = [];
  input.deadlineContext.stage = 'source_read';
  providerDiagnostic('daily_report', 'data', 'started');
  try {
    snapshot = await reportData.observeInitialDailyReportSnapshot(
      request.signal,
      () =>
        input.data.readDailyReportSnapshot!(
          calendar.context,
          request.scope,
          request.signal,
        ),
    );
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
    } = await reportData.observeDailyReportData(
      'daily_report_data_projection',
      request.signal,
      () =>
        prepareDailyReportFacts(input, request, calendar, snapshot, external),
    ));
  } catch {
    if (request.signal.aborted) return fail('cancelled');
    providerDiagnostic('daily_report', 'data', 'failed');
    return fail('source_read_failed');
  }
  providerDiagnostic('daily_report', 'data', 'completed');
  input.deadlineContext.stage = 'workflow';
  let context = createDailyReportContext(
    calendar.context,
    sourceSnapshot,
    {
      providerId: selected.provider.id,
      modelId: selected.modelId,
    },
    external?.binding,
  );
  const runId = input.createRunId();
  const gate = !external && input.pauseBeforeOpening;
  const day = calendar.context;
  if (gate) {
    const resumed = await gate(request, selected, snapshot, day, runId);
    if (!resumed) return fail('cancelled');
    if (resumed !== true) selected = resumed;
  }
  const currentSelection = await openingFor(
    input,
    request,
    selected,
    !!external?.facts.length,
    consent =>
      selectCurrentDailyReportFacts(
        { ...input, consent },
        request,
        selected,
        calendar,
        runId,
        snapshot,
        {
          required,
          factSourceIndexes,
          sourceSnapshot,
          facts,
          providerFacts,
          baselineFacts,
          sleepFacts,
        },
        external,
      ),
  );
  input.deadlineContext.stage = 'workflow';
  if (currentSelection.status === 'failed') return fail(currentSelection.code);
  const { selection, refresh } = currentSelection;
  snapshot = currentSelection.snapshot;
  ({
    required,
    factSourceIndexes,
    sourceSnapshot,
    facts,
    providerFacts,
    baselineFacts,
    sleepFacts,
  } = currentSelection.prepared);
  let proven = currentSelection.proven;
  if (refresh) {
    const latest = await reportData.postProviderProof(request.signal, refresh);
    if (!latest || (external && !(await external.snapshot.revalidate())))
      return fail(
        request.signal.aborted
          ? 'cancelled'
          : 'source_unconfirmed_after_dispatch',
      );
    proven = latest;
  }
  if (!currentSelection.currentOwner()) return fail('cancelled');
  context = createDailyReportContext(
    calendar.context,
    {
      ...sourceSnapshot,
      mutationGeneration: proven.sourceSnapshot.mutationGeneration,
      revision: external
        ? fingerprint({
            local: proven.sourceSnapshot.revision,
            systemCalendar: external.binding,
          })
        : proven.sourceSnapshot.revision,
    },
    context.provider,
    external?.binding,
  );
  const report = {
    schemaVersion: 1 as const,
    identity: context.identity,
    generatedAt: input.now(),
    observations: reportObservations(facts, required, selection.indexes),
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
  const { mode } = request;
  const candidate = {
    runId,
    context,
    result,
    lineage: snapshot.lineage,
    mode: mode.kind === 'revise' ? mode : { kind: 'initial' as const },
  };
  const saved = await persistDailyReportCandidate(
    input,
    candidate,
    calendar.context,
    request.signal,
    {
      selected,
      refresh,
      dispatchAuthority: input.dispatchAuthority,
      current: currentSelection.currentOwner,
      calendarCurrent: external?.snapshot.revalidate,
    },
  );
  if (saved.status === 'failed') return fail(saved.code);
  if (external && !(await external.snapshot.revalidate())) {
    await input.storage.lookup(saved.context.identity);
    // Persistence already ran; the route must recheck saved content even if Stop raced this lookup.
    return fail('source_unconfirmed_after_dispatch');
  }
  if (saved.liveAfterReproof?.() === false) return fail('cancelled');
  providerDiagnostic('daily_report', 'persistence', 'completed');
  providerDiagnostic('daily_report', 'workflow', 'result');
  return dailyReportLiveCommit(result, runId, saved);
}
