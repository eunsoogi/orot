import { dailyReportGuidance } from './dailyReportGuidance';
import { dailyReportActions } from './dailyReportActions';
import { dailyReportBehaviorInsights } from './dailyReportBehaviorInsights';
import { dailyReportPersonalBaseline } from './dailyReportPersonalBaseline';
import { fingerprint } from './evidenceUtils';
import {
  conflictingDailyReportIndexes,
  incomparableDailyReportIndexes,
  dailyReportFacts,
} from './dailyReportFacts';
import { dailyReportProviderFacts } from './dailyReportProjection';
import type { prepareReportCalendar } from './dailyReportSystemCalendar';
import type {
  DailyReportRunInput,
  DailyReportServiceRequest,
} from './dailyReportTypes';
import type { DailyReportCalendarWindow } from '../../healthEvidence/healthContext/dailyReportWindow';

/** Combine local facts and minimal plan facts while retaining separate source coverage. */
export async function prepareDailyReportFacts(
  input: DailyReportRunInput,
  request: DailyReportServiceRequest,
  calendar: { context: DailyReportCalendarWindow },
  snapshot: Awaited<
    ReturnType<
      NonNullable<DailyReportRunInput['data']['readDailyReportSnapshot']>
    >
  >,
  external?: Awaited<ReturnType<typeof prepareReportCalendar>>,
) {
  const conflicts = conflictingDailyReportIndexes(snapshot.values);
  const incomparable = incomparableDailyReportIndexes(snapshot.values);
  const required = [...new Set([...conflicts, ...incomparable])];
  const sourceSnapshot = {
    ...snapshot.sourceSnapshot,
    revision: external
      ? fingerprint({
          local: snapshot.sourceSnapshot.revision,
          systemCalendar: external.binding,
        })
      : snapshot.sourceSnapshot.revision,
    records: [
      ...snapshot.sourceSnapshot.records,
      ...(external ? [external.source] : []),
    ],
    coverage: [
      ...snapshot.sourceSnapshot.coverage,
      {
        source: 'system_calendar',
        status: external ? ('partial' as const) : ('unknown' as const),
        limitationCodes: [
          external
            ? 'planned_events_not_attendance'
            : 'calendar_unavailable_or_scoped_out',
        ],
      },
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
                ...(required.length > 8 ? ['conflicting_records_omitted'] : []),
              ],
            },
          ]
        : []),
    ],
  };
  const baselineFacts = dailyReportPersonalBaseline(
    snapshot.values,
    snapshot.baselineValues ?? [],
    snapshot.sourceSnapshot.records,
    calendar.context.identity.timeZone,
  );
  baselineFacts.push(
    ...dailyReportBehaviorInsights(
      snapshot.values,
      snapshot.behaviorValues ?? [],
      snapshot.sourceSnapshot.records,
      calendar.context.identity.timeZone,
    ),
  );
  const sources = snapshot.sourceSnapshot.records.slice(
    0,
    snapshot.values.length,
  );
  const guidance = [
    ...dailyReportGuidance(snapshot.values, sources),
    ...dailyReportActions(snapshot.values, sources),
  ].map(claim => ({
    ...claim,
    modelText: claim.text,
    role: 'guidance' as const,
  }));
  const facts = [
    ...dailyReportFacts(
      snapshot.values,
      snapshot.sourceSnapshot.records.slice(0, snapshot.values.length),
    ),
    ...(external?.facts ?? []),
    ...baselineFacts,
    ...guidance,
  ];
  const providerFacts = await dailyReportProviderFacts(
    input.data,
    [
      ...snapshot.values,
      ...(snapshot.baselineValues ?? []),
      ...(snapshot.behaviorValues ?? []),
    ],
    facts,
    request.signal,
  );
  return {
    required,
    sourceSnapshot,
    facts,
    baselineFacts,
    providerFacts: providerFacts.map((fact, index) => ({
      ...fact,
      role:
        index >= facts.length - guidance.length
          ? ('guidance' as const)
          : ('evidence' as const),
    })),
  };
}
