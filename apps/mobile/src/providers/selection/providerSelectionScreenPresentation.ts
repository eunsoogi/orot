import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { providerSelectionText } from './text';
import type { ProviderSelectionResolution } from './types';

/** Keeps copy mapping and layout tokens separate from provider-selection state transitions. */
export function resolutionMessage(
  resolution: ProviderSelectionResolution | null,
): string | null {
  if (!resolution || resolution.ok) return null;
  switch (resolution.reason) {
    case 'provider-unavailable':
      return resolution.message ?? providerSelectionText.unavailableProvider;
    case 'missing-capability':
      return providerSelectionText.unsupportedCapabilities;
    case 'selection-required':
    case 'selection-unavailable':
      return providerSelectionText.unavailableSelection;
  }
}

export const providerSelectionScreenStyles = StyleSheet.create({
  scrollView: { flex: 1 },
  // Account rows and disclosures must remain scrollable in short viewports.
  container: {
    flexGrow: 1,
    gap: 12,
    padding: 24,
    backgroundColor: appColors.background,
  },
  title: { color: appColors.text, fontSize: 24, fontWeight: '700' },
  introduction: { color: appColors.secondary, fontSize: 15 },
  error: { color: appColors.danger },
});
