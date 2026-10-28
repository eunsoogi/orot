import { useLayoutEffect, useMemo, useState } from 'react';
import { RecordingDeletionTimingProbe } from '../../src/recording/recordingDeletionTimingProbe';
import type { RecordingDeletionTimingReport } from '../../src/recording/recordingDeletionTimingReport';
import { RecordingDeletionTrace } from '../../src/recording/recordingDeletionTrace';

/** Logs diagnostic publication independently from the report acceptance rules. */
export function useRecordingDeletionProbe(enabled: boolean) {
  const [published, setPublished] = useState<{
    report: RecordingDeletionTimingReport;
    revision: number;
  } | null>(null);
  const probe = useMemo(() => {
    if (!enabled) return null;
    // Disposable identity has no relationship to recording or account content.
    const trace = new RecordingDeletionTrace(
      `sample-${Math.random().toString(36).slice(2)}`,
      entry =>
        console.info('OROT_RECORDING_DELETION_TRACE ' + JSON.stringify(entry)),
    );
    return new RecordingDeletionTimingProbe(
      undefined,
      report => {
        trace.record('fixture-publication-request', {
          eventCount: report.events.length,
        });
        setPublished({ report, revision: trace.reportRevision });
      },
      trace,
    );
  }, [enabled]);
  useLayoutEffect(() => {
    if (!published) return;
    probe?.trace?.record('fixture-publication-commit', {
      committedRevision: published.revision,
      eventCount: published.report.events.length,
    });
  }, [probe, published]);
  return { probe, report: published?.report ?? null };
}
