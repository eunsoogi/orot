import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  dailyReminderNative,
  type DailyReminderPreference,
  type DailyReminderResult,
} from './nativeDailyReminder';

export type DailyReminderSettingsStatus =
  'loading' | DailyReminderResult['status'];

export interface DailyReminderSettingsState {
  readonly authorization?: DailyReminderResult['authorization'];
  readonly hasLoaded: boolean;
  readonly loadError: boolean;
  readonly loading: boolean;
  /** Keeps the latest requested value visible until native state confirms it. */
  readonly pendingPreference: DailyReminderPreference | null;
  readonly preference: DailyReminderPreference | null;
  readonly saveError: boolean;
  readonly saving: boolean;
  readonly status: DailyReminderSettingsStatus;
}

const initialState: DailyReminderSettingsState = {
  hasLoaded: false,
  loadError: false,
  loading: true,
  pendingPreference: null,
  preference: null,
  saveError: false,
  saving: false,
  status: 'loading',
};

function samePreference(
  left: DailyReminderPreference,
  right: DailyReminderPreference,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

/** Treats scheduling as successful only when the bridge also confirms access. */
function resultStatus(
  result: DailyReminderResult,
): DailyReminderSettingsStatus {
  if (result.status === 'denied' || result.authorization === 'denied') {
    return 'denied';
  }
  if (result.status === 'scheduled' && result.authorization === 'authorized') {
    return 'scheduled';
  }
  if (result.status === 'disabled') return 'disabled';
  return 'error';
}

/** Reads saved reminder state and scheduling status without prompting for access. */
export function useDailyReminderSettings() {
  const [state, setState] = useState(initialState);
  const requestID = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestID.current;
    setState(current => ({
      ...current,
      loading: !current.hasLoaded,
      loadError: false,
    }));
    try {
      const native = dailyReminderNative();
      const [preference, result] = await Promise.all([
        native.read(),
        native.reconcile(),
      ]);
      if (request !== requestID.current) return;
      setState(current => {
        const pendingMatches =
          current.pendingPreference != null &&
          preference != null &&
          samePreference(current.pendingPreference, preference);
        if (current.pendingPreference != null && !pendingMatches) {
          return {
            ...current,
            authorization: result.authorization,
            hasLoaded: true,
            loadError: false,
            loading: false,
            saving: false,
            saveError: true,
            status: 'error',
            preference,
          };
        }
        return {
          ...current,
          authorization: result.authorization,
          hasLoaded: true,
          loadError: false,
          loading: false,
          pendingPreference: null,
          preference,
          saveError: false,
          saving: false,
          status: resultStatus(result),
        };
      });
    } catch {
      if (request !== requestID.current) return;
      setState(current => ({
        ...current,
        hasLoaded: true,
        loadError: true,
        loading: false,
        saving: false,
        status: 'error',
      }));
    }
  }, []);

  const save = useCallback(async (preference: DailyReminderPreference) => {
    const request = ++requestID.current;
    setState(current => ({
      ...current,
      loadError: false,
      pendingPreference: preference,
      saveError: false,
      saving: true,
    }));
    try {
      const result = await dailyReminderNative().save(preference);
      if (request !== requestID.current) return;
      setState(current => ({
        ...current,
        authorization: result.authorization,
        hasLoaded: true,
        loading: false,
        pendingPreference: null,
        preference,
        saveError: false,
        saving: false,
        status: resultStatus(result),
      }));
    } catch {
      if (request !== requestID.current) return;
      // Keep the requested value visible so an explicit retry can recover it.
      setState(current => ({
        ...current,
        hasLoaded: true,
        loading: false,
        pendingPreference: preference,
        saveError: true,
        saving: false,
        status: 'error',
      }));
    }
  }, []);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') refresh();
    });
    return () => {
      requestID.current += 1;
      subscription?.remove();
    };
  }, [refresh]);

  return { refresh, save, state };
}
