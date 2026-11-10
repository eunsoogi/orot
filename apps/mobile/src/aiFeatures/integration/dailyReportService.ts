import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import { createLocalEvidenceData } from '../../healthEvidence/localEvidenceData';
import type { EvidenceCandidateScope } from '../../healthEvidence/evidenceCandidateScope';
import { createDailyReportContext } from '../../healthEvidence/healthContext/dailyReportContext';
import {
  createDailyReportCalendarWindow,
  currentDailyReportContextRequest,
} from '../../healthEvidence/healthContext/dailyReportWindow';
import { createDailyReportStorage } from '../../storage/dailyReportStorage';
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
import { boundedDailyReport } from './dailyReportDeadline';
import { dailyReportProviderFacts } from './dailyReportProjection';

/** One explicit operation shares identity, source validation and storage for both entry points. */
export function createDailyReportService(input: {
  database: SqlDatabase;
  consent: ExecutionConsentPort;
  now: () => string;
  createRunId: () => string;
  resolveSelected?: () => Promise<SelectedAiResolution>;
  timeoutMs?: number;
}) {
  const data = createLocalEvidenceData(input.database);
  const storage = createDailyReportStorage(input.database);
  const run = async (request: {
    timeZone: string;
    scope: EvidenceCandidateScope;
    mode:
      | { kind: 'reuse_or_generate' }
      | { kind: 'revise'; expectedRunId: string | null };
    signal: AbortSignal;
  }) => {
    const fail = (code: string) => ({ status: 'failed' as const, code });
    if (request.signal.aborted) return fail('cancelled');
    if (request.scope.timeRange) return fail('invalid_context');
    const requested = currentDailyReportContextRequest(
      input.now(),
      request.timeZone,
    );
    if (requested.status !== 'ready') return fail('invalid_context');
    const calendar = createDailyReportCalendarWindow(requested.request);
    if (calendar.status !== 'ready') return fail('invalid_context');
    const existing = await storage.lookup(calendar.context.identity);
    if (request.signal.aborted) return fail('cancelled');
    if (request.mode.kind === 'reuse_or_generate') {
      if (existing.status === 'saved') {
        if (request.scope.sourceIds) {
          const priorWindow = createDailyReportCalendarWindow({
            localDate: existing.context.identity.localDate,
            timeZone: existing.context.identity.timeZone,
            requestedAt: existing.context.generationCutoff,
          });
          if (priorWindow.status !== 'ready') return fail('invalid_context');
          try {
            const permitted = await data.readDailyReportSnapshot!(
              priorWindow.context,
              request.scope,
              request.signal,
            );
            const allowed = new Set(
              permitted.sourceSnapshot.records.map(row =>
                stableJson([row.source, row.recordId, row.revision]),
              ),
            );
            if (
              existing.context.sourceSnapshot.records.some(
                row =>
                  !allowed.has(
                    stableJson([row.source, row.recordId, row.revision]),
                  ),
              )
            )
              return fail('source_unavailable');
          } catch {
            return fail(
              request.signal.aborted ? 'cancelled' : 'source_unavailable',
            );
          }
          const current = await storage.lookup(calendar.context.identity);
          if (
            current.status !== 'saved' ||
            current.runId !== existing.runId ||
            current.revision !== existing.revision
          )
            return fail('source_stale');
        }
        if (request.signal.aborted) return fail('cancelled');
        return { ...existing, status: 'reused' as const };
      }
      if (existing.status !== 'missing')
        return fail(
          existing.status === 'stale' ? 'source_stale' : 'source_unavailable',
        );
    }
    let selected: SelectedAiResolution;
    try {
      selected = await (input.resolveSelected ?? resolveSelectedAiProvider)();
    } catch {
      return fail('provider_unavailable');
    }
    if (request.signal.aborted) return fail('cancelled');
    if (selected.status !== 'ready') return fail('provider_unavailable');
    let snapshot: Awaited<
      ReturnType<NonNullable<typeof data.readDailyReportSnapshot>>
    >;
    try {
      snapshot = await data.readDailyReportSnapshot!(
        calendar.context,
        request.scope,
        request.signal,
      );
    } catch {
      return fail(request.signal.aborted ? 'cancelled' : 'source_unavailable');
    }
    if (!snapshot.values.length) return fail('source_unavailable');
    const conflicts = conflictingDailyReportIndexes(snapshot.values);
    const incomparable = incomparableDailyReportIndexes(snapshot.values);
    const required = [...new Set([...conflicts, ...incomparable])];
    const sourceSnapshot = {
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
    const context = createDailyReportContext(calendar.context, sourceSnapshot, {
      providerId: selected.provider.id,
      modelId: selected.modelId,
    });
    const facts = dailyReportFacts(
      snapshot.values,
      context.sourceSnapshot.records,
    );
    const runId = input.createRunId();
    const selection = await selectDailyReportFacts({
      selected,
      consent: input.consent,
      runId,
      facts: await dailyReportProviderFacts(
        data,
        snapshot.values,
        facts,
        request.signal,
      ),
      signal: request.signal,
      timeoutMs: input.timeoutMs ?? 90_000,
      revalidate: async signal => {
        const current = await data.readDailyReportSnapshot!(
          calendar.context,
          request.scope,
          signal,
        );
        return (
          stableJson(current.sourceSnapshot) ===
          stableJson(snapshot.sourceSnapshot)
        );
      },
    });
    if (selection.status === 'failed') return selection;
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
    if (!validateDailyReportCompletion(context, result))
      return fail('malformed_output');
    if (request.signal.aborted) return fail('cancelled');
    const saved = await storage.save(
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
    if (saved.status !== 'saved' && saved.status !== 'reused')
      return fail(
        saved.status === 'cancelled'
          ? 'cancelled'
          : saved.status === 'stale'
            ? 'source_revision_changed'
            : 'source_unavailable',
      );
    return { status: 'completed' as const, runId, context, report };
  };
  return (request: Parameters<typeof run>[0]) =>
    boundedDailyReport(request.signal, input.timeoutMs ?? 90_000, signal =>
      run({ ...request, signal }),
    );
}
