import { useEffect } from 'react';
import { AppState } from 'react-native';
import { publishDailyReportMemoryTap } from '../storage/dailyReportMemoryTap';

/** Load a positive capability in the background, not on the critical tap path. */
export function useWarmDailyReportMemory(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let sequence = 0;
    const observe = () => {
      const gate = ++sequence;
      const current = () =>
        gate === sequence && AppState.currentState === 'active';
      if (!current()) {
        publishDailyReportMemoryTap();
        return;
      }
      const ports =
        require('../memory/openSavedGeneratedReportReferences') as typeof import('../memory/openSavedGeneratedReportReferences');
      ports
        .openSavedGeneratedReportReferences()
        .then(storage =>
          current() ? storage.readAutomaticDailyReportMemory(current) : false,
        )
        .catch(() => {});
    };
    const listener = AppState.addEventListener('change', observe);
    observe();
    return () => {
      sequence++;
      publishDailyReportMemoryTap();
      listener.remove();
    };
  }, [enabled]);
}
