import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import { createAutomaticRecapService } from './automaticRecapService';
import { setRecapForegroundConsent } from './productionRecapCompletion';
import { subscribeRecapRetry } from './recapUpdates';

/** Resume unfinished linked transcripts only while a consent surface can be shown. */
export function useRecapRecovery(consent: ExecutionConsentPort) {
  useEffect(() => {
    const controllers = new Set<AbortController>();
    let disposed = false;
    const start = async (appointmentId?: string) => {
      const current = new AbortController();
      controllers.add(current);
      try {
        const { openLocalAgentMemoryDatabase } =
          await import('../storage/secureDatabase');
        const database = await openLocalAgentMemoryDatabase();
        if (disposed || current.signal.aborted) return;
        const rows = await database.execute(
          `SELECT b.recording_id FROM recap_bindings b
          LEFT JOIN recap_results r ON r.recording_id = b.recording_id
          WHERE b.appointment_id IS NOT NULL AND COALESCE(r.saved, 0) = 0
          AND EXISTS (SELECT 1 FROM transcript_segments t WHERE json_extract(t.payload_json, '$.recordingSourceId') = b.recording_id)
          AND (? IS NULL OR b.appointment_id = ?)`,
          [appointmentId ?? null, appointmentId ?? null],
        );
        const run = createAutomaticRecapService(database, consent);
        for (const row of rows.rows) {
          if (current.signal.aborted) break;
          if (typeof row.recording_id === 'string')
            await run(row.recording_id, [], current.signal);
        }
      } catch {
        // An unavailable database or provider remains pending for the next foreground attempt.
      } finally {
        controllers.delete(current);
      }
    };
    if (AppState.currentState === 'active') {
      setRecapForegroundConsent(consent);
      start();
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setRecapForegroundConsent(consent);
        start();
      } else {
        setRecapForegroundConsent(null);
        controllers.forEach(controller => controller.abort());
      }
    });
    const unsubscribeRetry = subscribeRecapRetry(appointmentId => {
      if (AppState.currentState === 'active') start(appointmentId);
    });
    return () => {
      disposed = true;
      setRecapForegroundConsent(null);
      controllers.forEach(controller => controller.abort());
      subscription.remove();
      unsubscribeRetry();
    };
  }, [consent]);
}
