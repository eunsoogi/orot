import { t } from '../../i18n';
import { APPLE_PCC_PROVIDER_ID } from './privateCloudCompute';
import { ProviderModelChoiceRow } from './ProviderModelChoiceRow';
import { isProviderSelectionOptionSelectable } from './providerSelection';
import { providerSelectionText } from './text';
import type {
  ProviderSelectionOption,
  ProviderSelectionRequirements,
} from './types';

interface ProviderSelectionOptionCardProps {
  readonly option: ProviderSelectionOption;
  readonly requirements: ProviderSelectionRequirements;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly presentationOnly?: boolean;
  readonly index: number;
  readonly catalogModelLabel?: string;
  readonly hideLocalSubtitle?: boolean;
  readonly onPress: () => void;
}

export default function ProviderSelectionOptionCard({
  option,
  requirements,
  selected,
  disabled,
  index,
  presentationOnly = false,
  catalogModelLabel,
  hideLocalSubtitle = false,
  onPress,
}: ProviderSelectionOptionCardProps) {
  // Descriptive capability lists are omitted; actual capability and availability gates stay enforced.
  const blockedMessage = presentationOnly
    ? null
    : getBlockedMessage(option, requirements);
  const selectable = blockedMessage === null && !disabled;
  return (
    <ProviderModelChoiceRow
      key={`${option.provider.id}:${option.modelId}`}
      testID={`provider-option-${index}`}
      title={catalogModelLabel ?? option.displayName}
      detail={
        catalogModelLabel ||
        (hideLocalSubtitle && option.privacyBoundary === 'on-device')
          ? undefined
          : option.privacyBoundary === 'on-device'
            ? t('modelSettings.localProcessing')
            : option.provider.id === APPLE_PCC_PROVIDER_ID
              ? t('provider.pcc.processing')
              : option.modelId
      }
      icon={option.privacyBoundary === 'on-device' ? 'sparkles' : 'brain'}
      blockedMessage={blockedMessage}
      selected={selected}
      disabled={!selectable}
      onPress={onPress}
    />
  );
}

function getBlockedMessage(
  option: ProviderSelectionOption,
  requirements: ProviderSelectionRequirements,
): string | null {
  if (option.availability.status === 'unavailable') {
    return (
      option.availability.message || providerSelectionText.unavailableProvider
    );
  }
  return isProviderSelectionOptionSelectable(option, requirements)
    ? null
    : providerSelectionText.unsupportedCapabilities;
}
