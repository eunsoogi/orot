import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import { createDailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';
import { providerDiagnostic } from '../../providers/diagnostics';
import { validateDailyReportCompletion } from '../../storage/dailyReportValidation';
import { resolveSelectedAiProvider } from './provider';
import type { SelectedAiResolution } from './provider';
import {
  conflictingDailyReportIndexes,
  incomparableDailyReportIndexes,
  dailyReportFacts,
} from './dailyReportFacts';
import { selectDailyReportFacts } from './dailyReportModel';
import { stableJson } from './evidenceUtils';
import { dailyReportProviderFacts } from './dailyReportProjection';
import { reportFailureOutcome } from './dailyReportFailureDiagnostics';
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
export async function generateDailyReport(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
  calendar: ReadyCalendar,
) {
  const fail = (code: DailyReportFailureCode) => {
    providerDiagnostic('daily_report', 'workflow', reportFailureOutcome(code));
    return { status: 'failed' as const, code };
  };

  providerDiagnostic('daily_report', 'selection', 'started');
  let selected: SelectedAiResolution;
  try {
    selected = await (input.resolveSelected ?? resolveSelectedAiProvider)();
  } catch {
    if (request.signal.aborted) return fail('cancelled');
    providerDiagnostic('daily_report', 'selection', 'unavailable');
    return fail('provider_unavailable');
  }
  if (request.signal.aborted) return fail('cancelled');
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
    const conflicts = conflictingDailyReportIndexes(snapshot.values);
    const incomparable = incomparableDailyReportIndexes(snapshot.values);
    required = [...new Set([...conflicts, ...incomparable])];
    sourceSnapshot = {
      ...snapshot.sourceSnapshot,
      coverage: [
        ...snapshot.sourceSnapshot.coverage,
        {
          source: 'calendar',
          status: calendar.context.partial
            ? ('partial' as const)
            : ('available' as const),
          limitationCodes: calendar.context.partial ? ['partial_day'] : [],
        },
        {
          source: 'report_selection',
          status: 'partial' as const,
          limitationCodes: ['selected_facts_only'],
        },
        ...(required.length
          ? [
              {
                source: 'record_conflicts',
                status: 'partial' as const,
                limitationCodes: [
                  ...(conflicts.length ? ['conflicting_measurements'] : []),
                  ...(incomparable.length ? ['incomparable_units'] : []),
                  ...(required.length > 8
                    ? ['conflicting_records_omitted']
                    : []),
                ],
              },
            ]
          : []),
      ],
    };
    facts = dailyReportFacts(snapshot.values, sourceSnapshot.records);
    providerFacts = await dailyReportProviderFacts(
      input.data,
      snapshot.values,
      facts,
      request.signal,
    );
  } catch {
    if (request.signal.aborted) return fail('cancelled');
    providerDiagnostic('daily_report', 'data', 'failed');
    return fail('source_read_failed');
  }
  providerDiagnostic('daily_report', 'data', 'completed');

  const context = createDailyReportContext(calendar.context, sourceSnapshot, {
    providerId: selected.provider.id,
    modelId: selected.modelId,
  });
  const runId = input.createRunId();
  const selection = await selectDailyReportFacts({
    selected,
    consent: input.consent,
    runId,
    facts: providerFacts,
    signal: request.signal,
    timeoutMs: input.timeoutMs ?? 90_000,
    revalidate: async signal => {
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
      return (
        stableJson(current.sourceSnapshot) ===
        stableJson(snapshot.sourceSnapshot)
      );
    },
  });
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
    supportedContext: [],
    coverage: context.sourceSnapshot.coverage,
    followUpQuestions: [],
  };
  const result = { status: 'completed' as const, report };
  providerDiagnostic('daily_report', 'validation', 'started');
  if (!validateDailyReportCompletion(context, result)) {
    providerDiagnostic('daily_report', 'validation', 'invalid_output');
    return fail('malformed_output');
  }
  providerDiagnostic('daily_report', 'validation', 'completed');
  if (request.signal.aborted) return fail('cancelled');

  providerDiagnostic('daily_report', 'persistence', 'started');
  let saved: Awaited<ReturnType<typeof input.storage.save>>;
  try {
    saved = await input.storage.save(
      {
        runId,
        context,
        result,
        lineage: snapshot.lineage,
        mode:
          request.mode.kind === 'revise' ? request.mode : { kind: 'initial' },
      },
      request.signal,
    );
  } catch {
    providerDiagnostic(
      'daily_report',
      'persistence',
      request.signal.aborted ? 'cancelled' : 'failed',
    );
    return fail(request.signal.aborted ? 'cancelled' : 'persistence_failed');
  }
  if (saved.status !== 'saved' && saved.status !== 'reused') {
    providerDiagnostic(
      'daily_report',
      'persistence',
      saved.status === 'cancelled' ? 'cancelled' : 'failed',
    );
    return fail(
      saved.status === 'cancelled'
        ? 'cancelled'
        : saved.status === 'stale'
          ? 'source_revision_changed'
          : saved.status === 'deleted'
            ? 'source_unavailable'
            : 'persistence_failed',
    );
  }
  providerDiagnostic('daily_report', 'persistence', 'completed');
  providerDiagnostic('daily_report', 'workflow', 'result');
  return { status: 'completed' as const, runId, context, report };
}
