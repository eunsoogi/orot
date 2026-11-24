import ProviderSelectionOptionCard from '../providers/selection/ProviderSelectionOptionCard';
import { applePrivateCloudComputeProvider } from '../providers/apple';
import { APPLE_PCC_MODEL_ID } from '../providers/selection/privateCloudCompute';
import { t } from '../i18n';

/** Display-only: PCC has no Voice runtime and cannot be selected or saved. */
export function VoiceSettingsUnavailablePccOption() {
  return (
    <ProviderSelectionOptionCard
      option={{
        provider: applePrivateCloudComputeProvider,
        modelId: APPLE_PCC_MODEL_ID,
        displayName: 'Apple Intelligence',
        privacyBoundary: 'selected-context-remote',
        availability: {
          status: 'unavailable',
          message: t('provider.pcc.entitlementRequired'),
        },
      }}
      requirements={{ inputTypes: ['text'] }}
      disabled
      selected={false}
      index={0}
      onPress={() => undefined}
    />
  );
}
