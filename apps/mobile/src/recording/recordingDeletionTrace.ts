export interface RecordingDeletionTraceEntry {
  readonly sampleId: string;
  readonly sequence: number;
  readonly monotonicMs: number;
  readonly event: string;
  readonly reportRevision: number;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

/** Independent opt-in chronology never adds timing marks or changes deletion state. */
export class RecordingDeletionTrace {
  private sequence = 0;
  reportRevision = 0;

  constructor(
    readonly sampleId: string,
    private readonly sink: (entry: RecordingDeletionTraceEntry) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  record(
    event: string,
    details: RecordingDeletionTraceEntry['details'] = {},
  ): void {
    try {
      this.sink({
        sampleId: this.sampleId,
        sequence: ++this.sequence,
        monotonicMs: this.now(),
        event,
        reportRevision: this.reportRevision,
        details,
      });
    } catch {
      // Diagnostic failures cannot affect consent, deletion, or React commits.
    }
  }

  beginReport(eventCount: number): void {
    this.reportRevision += 1;
    this.record('report-call', { eventCount });
  }
}
