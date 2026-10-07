import type {
  EvidenceBatch,
  EvidenceItem,
  EvidenceReference,
} from '@orot/agent-runtime';
import { calendarSnapshotsEqual } from '../calendar/calendarSnapshot';
import type { CalendarBridge, CalendarEvent } from '../calendar/types';
import type { CalendarAccessState } from '../calendar/types';

export const CALENDAR_QUERY_EVENT_LIMIT = 100;
export const CALENDAR_QUERY_HORIZON_YEARS = 1;
export const MAX_CLASSIFICATION_EVIDENCE_ITEMS = 8;

export interface CalendarEvidenceBatch {
  readonly events: readonly CalendarEvent[];
  readonly evidence: EvidenceBatch;
  readonly batchIndex: number;
  readonly batchCount: number;
  revalidateEvidence(
    references: readonly EvidenceReference[],
    signal: AbortSignal,
  ): Promise<boolean>;
}

export interface CalendarCandidateSet {
  readonly access: CalendarAccessState;
  readonly events: readonly CalendarEvent[];
  readonly resultLimit: typeof CALENDAR_QUERY_EVENT_LIMIT;
  readonly horizonYears: typeof CALENDAR_QUERY_HORIZON_YEARS;
  readonly complete: false;
}

/** Reads the user-authorized bounded query and preserves its unknown overflow state. */
export async function readUpcomingCalendarCandidates(
  bridge: CalendarBridge,
): Promise<CalendarCandidateSet> {
  const result = await bridge.requestAccessAndListUpcomingEvents();
  return {
    access: result.access,
    events: result.access === 'fullAccess' ? result.events : [],
    resultLimit: CALENDAR_QUERY_EVENT_LIMIT,
    horizonYears: CALENDAR_QUERY_HORIZON_YEARS,
    complete: false,
  };
}

/**
 * The EventKit bridge returns at most 100 events for the next year and exposes no
 * has-more flag; callers must describe this as a bounded candidate view.
 */
export function createCalendarEvidenceBatch(
  bridge: CalendarBridge,
  events: readonly CalendarEvent[],
  startIndex: number,
  batchIndex: number,
  batchCount: number,
): CalendarEvidenceBatch {
  if (
    events.length > MAX_CLASSIFICATION_EVIDENCE_ITEMS ||
    !Number.isInteger(batchIndex) ||
    batchIndex < 0 ||
    !Number.isInteger(batchCount) ||
    batchCount < 1 ||
    batchIndex >= batchCount
  ) {
    throw new RangeError('Calendar evidence must fit one valid runtime batch.');
  }
  const indexed = events.map((event, index) => ({
    event,
    item: makeEvidenceItem(event, startIndex + index),
  }));
  const ids = indexed.length > 0 ? ['ios-calendar'] : [];
  const limit = Math.max(1, indexed.length);
  const items = indexed.map(({ item }) => item);
  const evidence: EvidenceBatch = {
    items,
    conflicts: [],
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: ids,
        gaps: [],
        truncated: false,
        resultLimit: limit,
        returnedCount: items.length,
      },
    ],
  };
  const byEvidenceId = new Map(
    indexed.map(({ event, item }) => [item.evidenceId, event]),
  );

  return {
    events,
    evidence,
    batchIndex,
    batchCount,
    async revalidateEvidence(references, signal) {
      // Each occurrence is re-read by its EventKit identifier and occurrence time before model use.
      for (const reference of references) {
        if (signal.aborted || reference.sourceKind !== 'personal_record')
          return false;
        const event = byEvidenceId.get(reference.evidenceId);
        const item = items.find(
          candidate => candidate.evidenceId === reference.evidenceId,
        );
        if (
          !event ||
          !item ||
          item.sourceId !== reference.sourceId ||
          item.sourceRevision !== reference.sourceRevision ||
          item.evidenceRevision !== reference.evidenceRevision
        ) {
          return false;
        }
        try {
          const current = await bridge.findEvent(
            event.calendarEventIdentifier,
            event.calendarEventSnapshot.occurrenceDate,
            event.calendarEventSnapshot.floatingOccurrenceAt ?? null,
          );
          if (
            signal.aborted ||
            current.access !== 'fullAccess' ||
            !current.event ||
            !calendarEventsMatch(event, current.event)
          ) {
            return false;
          }
        } catch {
          return false;
        }
      }
      return references.length > 0;
    },
  };
}

export function calendarEventsMatch(
  left: CalendarEvent,
  right: CalendarEvent,
): boolean {
  const leftSnapshot = left.calendarEventSnapshot;
  const rightSnapshot = right.calendarEventSnapshot;
  const sameFloatingCivilTime =
    leftSnapshot.timeZoneIdentifier === null &&
    rightSnapshot.timeZoneIdentifier === null &&
    typeof leftSnapshot.floatingStartAt === 'string' &&
    typeof leftSnapshot.floatingEndAt === 'string' &&
    leftSnapshot.floatingStartAt === rightSnapshot.floatingStartAt &&
    leftSnapshot.floatingEndAt === rightSnapshot.floatingEndAt;
  return (
    left.calendarEventIdentifier === right.calendarEventIdentifier &&
    (sameFloatingCivilTime ||
      (left.effectiveAt === right.effectiveAt &&
        left.endsAt === right.endsAt)) &&
    calendarSnapshotsEqual(leftSnapshot, rightSnapshot)
  );
}

function makeEvidenceItem(event: CalendarEvent, index: number): EvidenceItem {
  const evidenceId = `calendar-candidate-${index + 1}`;
  const snapshot = event.calendarEventSnapshot;
  // Only title and appointment time enter the model payload; identifiers remain local references.
  const content = JSON.stringify({
    candidateId: evidenceId,
    title: snapshot.title,
    startsAt: event.effectiveAt,
    endsAt: event.endsAt,
    isAllDay: snapshot.isAllDay,
    timeZone: snapshot.timeZoneIdentifier,
  });
  return {
    sourceKind: 'personal_record',
    sourceId: 'ios-calendar',
    sourceRevision: 'eventkit-live-snapshot-v1',
    evidenceId,
    evidenceRevision: 'candidate-snapshot-v1',
    locator: {
      kind: 'calendar_occurrence',
      candidateId: evidenceId,
    },
    effectiveTime: event.effectiveAt,
    reviewState: 'unknown',
    content,
  };
}
