import { APPLE_PCC_PROVIDER_ID } from '@orot/provider-apple';
import { t } from '../../i18n';
import { applePrivateCloudComputeProvider } from '../apple';
import type { ProviderSelectionOption } from './types';

export const APPLE_PCC_MODEL_ID = 'apple-private-cloud-compute-default';
export const APPLE_PCC_DISPLAY_NAME = 'Apple Intelligence';
export { APPLE_PCC_PROVIDER_ID };

/** PCC remains remote even though its platform transport protects request privacy. */
export async function loadPrivateCloudComputeOption(): Promise<ProviderSelectionOption> {
  let message: string | undefined;
  try {
    const availability =
      await applePrivateCloudComputeProvider.getAvailability();
    switch (availability.status) {
      case 'available':
        break;
      case 'unsupportedOS':
        message = t('provider.pcc.unsupportedOS');
        break;
      case 'entitlementRequired':
        message = t('provider.pcc.entitlementRequired');
        break;
      case 'quotaExceeded':
        message = t('provider.pcc.quotaExceeded');
        break;
      default:
        message = t('provider.pcc.unavailable');
    }
  } catch {
    message = t('provider.pcc.unavailable');
  }
  return {
    provider: applePrivateCloudComputeProvider,
    modelId: APPLE_PCC_MODEL_ID,
    displayName: APPLE_PCC_DISPLAY_NAME,
    privacyBoundary: 'selected-context-remote',
    availability: message
      ? { status: 'unavailable', message }
      : { status: 'available' },
  };
}
