import { Appearance, Settings } from 'react-native';

export const displayModes = ['system', 'light', 'dark'] as const;
export type DisplayMode = (typeof displayModes)[number];

// This nonsecret app preference shares its key with SceneDelegate's cold window setup.
const displayModeKey = 'orot.app.display-mode.v1';

/** Missing or unrecognized settings must follow the system, including after upgrades. */
export function readAppDisplayMode(): DisplayMode {
  const value: unknown = Settings.get(displayModeKey);
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Persist the choice independently of the current OS appearance. Native auto
 * clears the window override and resumes UIKit and React Native trait updates. */
export function setAppDisplayMode(mode: DisplayMode): void {
  Settings.set({ [displayModeKey]: mode });
  Appearance.setColorScheme(mode === 'system' ? 'auto' : mode);
}
