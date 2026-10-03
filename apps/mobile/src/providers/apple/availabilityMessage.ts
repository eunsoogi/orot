import { t } from '../../i18n';
import type { AppleAvailabilityStatus } from '@orot/provider-apple';

export function appleAvailabilityMessage(status: AppleAvailabilityStatus): string {
  switch (status) {
    case 'available':
      return t('provider.apple.available');
    case 'disabled':
      return t('provider.apple.disabled');
    case 'modelNotReady':
      return t('provider.apple.modelNotReady');
    case 'unsupportedDevice':
      return t('provider.apple.unsupportedDevice');
    case 'unsupportedLanguage':
      return t('provider.apple.unsupportedLanguage');
  }
}

export function appleGenerationFailureMessage(): string {
  return t('provider.apple.generationFailed');
}
