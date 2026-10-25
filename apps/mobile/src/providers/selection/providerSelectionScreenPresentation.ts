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
  root: { flex: 1, backgroundColor: appColors.background },
  footerContent: { maxHeight: 230 },
  footerBody: { gap: 10 },
  footer: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: appColors.background,
  },
  summary: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
  },
  scrollView: { flex: 1 },
  // Account rows and disclosures must remain scrollable in short viewports.
  container: {
    flexGrow: 1,
    gap: 12,
    padding: 20,
    backgroundColor: appColors.background,
  },
  title: {
    color: appColors.text,
    fontSize: 32,
    fontWeight: '700',
    marginTop: 16,
  },
  introduction: { color: appColors.secondary, fontSize: 17 },
  error: { color: appColors.danger },
});
