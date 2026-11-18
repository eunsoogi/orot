import { useEffect, useMemo } from 'react';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { createRealtimeSettingsPermission } from './createRealtimeSettingsPermission';

/** A continuing grant owns a revocable audio lease; OS permissions remain separate. */
export function useRealtimeSettingsPermission() {
  const { consent } = useInferenceConsent();
  const value = useMemo(
    () => createRealtimeSettingsPermission(consent),
    [consent],
  );
  useEffect(() => () => value.stop(), [value]);
  return value;
}
