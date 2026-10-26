import { NativeModules } from 'react-native';

/** Reads test-entry launch arguments without persisting them in the application's stored settings. */
export function probeSourceIdentifier(key: string): string | null {
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const value =
    settingsManager?.settings?.[key] ??
    settingsManager?.getConstants?.().settings?.[key];
  return typeof value === 'string' ? value : null;
}
