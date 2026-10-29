import type {
  RecordingDeletionTimingMark,
  RecordingDeletionTimingOutcome,
  RecordingDeletionTimingProbe as RecordingDeletionTimingProbeContract,
  RecordingDeletionTimingSpan,
} from './recordingDeletionTiming';

import type {
  RecordingDeletionTimingReport,
  RecordingDeletionTimingEvent,
} from './recordingDeletionTimingReport';
import type { RecordingDeletionTrace } from './recordingDeletionTrace';
export type {
  RecordingDeletionTimingReport,
  RecordingDeletionTimingEvent,
} from './recordingDeletionTimingReport';

/** Collects one opt-in sample without storing a recording identity or content. */
export class RecordingDeletionTimingProbe implements RecordingDeletionTimingProbeContract {
  private readonly events: RecordingDeletionTimingEvent[] = [];
  private readonly markedStages = new Set<RecordingDeletionTimingMark>();
  private startedAt: number | null = null;
  private deletionOutcome: RecordingDeletionTimingOutcome | null = null;
  private reportedEventCount = 0;

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly onReport?: (report: RecordingDeletionTimingReport) => void,
    readonly trace?: RecordingDeletionTrace,
  ) {}

  mark(stage: RecordingDeletionTimingMark): void {
    this.trace?.record('mark-entry', { stage });
    if (this.startedAt === null && stage !== 'confirmation-tap') {
      this.trace?.record('mark-not-started', { stage });
      return;
    }
    if (this.markedStages.has(stage)) {
      this.trace?.record('mark-duplicate', { stage });
      return;
    }
    const at = this.now();
    if (stage === 'confirmation-tap' && this.startedAt === null) {
      this.startedAt = at;
    }
    this.markedStages.add(stage);
    this.record(stage, 'mark', at);
    this.trace?.record('mark-accepted', { stage });
    if (
      stage === 'list-refresh' ||
      stage === 'list-summary-refresh' ||
      (stage === 'progress-presented' && this.reportedEventCount > 0)
    ) {
      // Preserve late native layout observations without treating them as ordered success.
      this.deliverUpdatedReport();
    }
  }

  begin(stage: RecordingDeletionTimingSpan): void {
    this.record(stage, 'begin', this.now());
  }

  end(
    stage: RecordingDeletionTimingSpan,
    outcome: RecordingDeletionTimingOutcome,
  ): void {
    this.record(stage, 'end', this.now(), outcome);
  }

  finish(outcome: RecordingDeletionTimingOutcome): void {
    if (this.deletionOutcome === null) this.deletionOutcome = outcome;
  }

  snapshot(): RecordingDeletionTimingReport {
    const events = [...this.events];
    const findEvent = (
      stage: RecordingDeletionTimingMark | RecordingDeletionTimingSpan,
      phase: RecordingDeletionTimingEvent['phase'],
    ) => events.find(event => event.stage === stage && event.phase === phase);
    const duration = (stage: RecordingDeletionTimingSpan) => {
      const start = findEvent(stage, 'begin');
      const end = findEvent(stage, 'end');
      return start && end ? end.elapsedMs - start.elapsedMs : null;
    };
    const markDelta = (
      startStage: RecordingDeletionTimingMark,
      endStage: RecordingDeletionTimingMark,
    ) => {
      const start = findEvent(startStage, 'mark');
      const end = findEvent(endStage, 'mark');
      return start && end ? end.elapsedMs - start.elapsedMs : null;
    };
    const audioEnd = findEvent('audio-cleanup', 'end');
    const listRefresh = findEvent('list-refresh', 'mark');
    const audioCleanupToListRefresh =
      audioEnd && listRefresh
        ? listRefresh.elapsedMs - audioEnd.elapsedMs
        : null;
    const summaryReadEvents = events.filter(
      event => event.stage === 'list-summary-read',
    );
    const summaryReadStart = findEvent('list-summary-read', 'begin');
    const summaryReadEnd = findEvent('list-summary-read', 'end');
    const summaryRefresh = findEvent('list-summary-refresh', 'mark');
    const optionalSummaryReadValid =
      (summaryReadEvents.length === 0 && summaryRefresh === undefined) ||
      (summaryReadEvents.length === 2 &&
        summaryReadStart !== undefined &&
        summaryReadEnd !== undefined &&
        summaryReadEnd.elapsedMs >= summaryReadStart.elapsedMs &&
        summaryRefresh !== undefined &&
        events.findIndex(event => event === summaryRefresh) >
          events.findIndex(event => event === summaryReadEnd));
    const orderedStageEvents: ReadonlyArray<
      readonly [
        RecordingDeletionTimingEvent['stage'],
        RecordingDeletionTimingEvent['phase'],
      ]
    > = [
      ['source-read', 'begin'],
      ['source-read', 'end'],
      ['stop-check', 'begin'],
      ['stop-check', 'end'],
      ['audio-staging', 'begin'],
      ['audio-staging', 'end'],
      ['memory-open', 'begin'],
      ['memory-open', 'end'],
      ['derived-data-cleanup', 'begin'],
      ['derived-data-cleanup', 'end'],
      ['database-delete-commit', 'begin'],
      ['database-delete-commit', 'end'],
      ['audio-cleanup', 'begin'],
      ['audio-cleanup', 'end'],
    ];
    const serviceIndexes = orderedStageEvents.map(([stage, phase]) =>
      events.findIndex(event => event.stage === stage && event.phase === phase),
    );
    const exactSpanEvents = orderedStageEvents.every(
      ([stage, phase]) =>
        events.filter(event => event.stage === stage && event.phase === phase)
          .length === 1,
    );
    const confirmationIndex = events.findIndex(
      event => event.stage === 'confirmation-tap' && event.phase === 'mark',
    );
    const progressIndex = events.findIndex(
      event => event.stage === 'progress-presented' && event.phase === 'mark',
    );
    const listRefreshIndex = events.findIndex(
      event => event.stage === 'list-refresh' && event.phase === 'mark',
    );
    const orderedService = serviceIndexes.every(
      (index, position) =>
        index >= 0 &&
        (position === 0 || index > (serviceIndexes[position - 1] ?? -1)),
    );
    const validOrder =
      confirmationIndex >= 0 &&
      progressIndex > confirmationIndex &&
      listRefreshIndex > progressIndex &&
      orderedService &&
      (serviceIndexes[0] ?? -1) > confirmationIndex &&
      listRefreshIndex >
        (serviceIndexes[serviceIndexes.length - 1] ?? Number.MAX_SAFE_INTEGER);
    const durationsMs = {
      confirmationToProgress: markDelta(
        'confirmation-tap',
        'progress-presented',
      ),
      sourceRead: duration('source-read'),
      stopCheck: duration('stop-check'),
      audioStaging: duration('audio-staging'),
      memoryOpen: duration('memory-open'),
      derivedDataCleanup: duration('derived-data-cleanup'),
      databaseDeleteCommit: duration('database-delete-commit'),
      audioCleanup: duration('audio-cleanup'),
      audioCleanupToListRefresh,
      confirmationToListRefresh: markDelta('confirmation-tap', 'list-refresh'),
      listSummaryRead: duration('list-summary-read'),
    };
    const values = Object.values(durationsMs).filter(
      (value): value is number => value !== null,
    );
    const validDurations = values.every(
      value => Number.isFinite(value) && value >= 0,
    );
    const validEventTimes = events.every(
      event => Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0,
    );
    const complete =
      exactSpanEvents &&
      optionalSummaryReadValid &&
      validOrder &&
      this.deletionOutcome !== null &&
      validDurations &&
      validEventTimes;

    return {
      schema: 'orot.recording-deletion-timing.v1',
      clock: 'performance.now',
      unit: 'ms',
      complete,
      succeeded: this.deletionOutcome === 'success',
      events,
      durationsMs,
    };
  }

  private deliverUpdatedReport(): void {
    if (!this.onReport || this.reportedEventCount === this.events.length)
      return;
    this.reportedEventCount = this.events.length;
    try {
      this.trace?.beginReport(this.events.length);
      this.onReport(this.snapshot());
      this.trace?.record('report-return');
    } catch {
      this.trace?.record('report-exception');
      // Report delivery is diagnostic and cannot affect the screen update.
    }
  }

  private record(
    stage: RecordingDeletionTimingEvent['stage'],
    phase: RecordingDeletionTimingEvent['phase'],
    at: number,
    outcome?: RecordingDeletionTimingOutcome,
  ): void {
    if (this.startedAt === null) return;
    this.events.push({
      stage,
      phase,
      elapsedMs: at - this.startedAt,
      ...(outcome ? { outcome } : {}),
    });
  }
}
