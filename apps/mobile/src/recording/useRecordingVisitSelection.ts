import { useState } from 'react';
import { bindSelectedVisit } from './bindSelectedVisit';
import { errorMessage } from './recordingErrors';

/** The visible selection changes only after its durable link has committed. */
export function useRecordingVisitSelection(options: {
  recordingId: string | null;
  sourceSaved: boolean;
  setBusy(value: boolean): void;
  setError(value: string): void;
  start(id: string): Promise<void>;
  cancel(id: string): void;
}) {
  const [selectedVisit, setSelectedVisit] = useState<string | null>(null);
  async function selectVisit(appointmentId: string | null) {
    const id = options.recordingId;
    if (!id || !options.sourceSaved) {
      setSelectedVisit(appointmentId);
      return;
    }
    options.setBusy(true);
    options.setError('');
    try {
      await bindSelectedVisit(id, appointmentId);
      setSelectedVisit(appointmentId);
      if (appointmentId) options.start(id);
      else options.cancel(id);
    } catch (reason) {
      options.setError(errorMessage(reason));
    } finally {
      options.setBusy(false);
    }
  }
  return { selectedVisit, selectVisit };
}
