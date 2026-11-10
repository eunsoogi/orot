import { NativeModules } from 'react-native';

export interface DailyReminderPreference {
  readonly enabled: boolean;
  readonly hour: number;
  readonly minute: number;
}

export interface DailyReminderResult {
  readonly status: 'scheduled' | 'denied' | 'disabled' | 'error';
  readonly authorization?: 'authorized' | 'denied' | 'notDetermined';
  readonly requestIdentifiers: readonly string[];
}

export interface DailyReminderNativeModule {
  read(): Promise<DailyReminderPreference | null>;
  save(preference: DailyReminderPreference): Promise<DailyReminderResult>;
  reconcile(): Promise<DailyReminderResult>;
}

/** Only an explicit enabled save can request notification permission. */
export function dailyReminderNative(): DailyReminderNativeModule {
  const module = NativeModules.DailyReminderModule as
    DailyReminderNativeModule | undefined;
  if (!module) throw new Error('Daily reminders are unavailable.');
  return module;
}
