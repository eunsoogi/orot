import { t } from '../../i18n';
import { APPLE_PCC_PROVIDER_ID } from './privateCloudCompute';
import { AppText as Text } from '../../layout/AppText';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../../layout/AppSymbol';
import { providerSettingsStyles as shared } from '../../layout/providerSettingsPresentation';
import { appColors } from '../../layout/appColors';
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
  readonly index: number;
  readonly onPress: () => void;
}

export default function ProviderSelectionOptionCard({
  option,
  requirements,
  selected,
  disabled,
  index,
  onPress,
}: ProviderSelectionOptionCardProps) {
  // Descriptive capability lists are omitted; actual capability and availability gates stay enforced.
  const blockedMessage = getBlockedMessage(option, requirements);
  const selectable = blockedMessage === null && !disabled;
  return (
    <Pressable
      key={`${option.provider.id}:${option.modelId}`}
      accessibilityRole="radio"
      accessibilityState={{ disabled: !selectable, selected }}
      disabled={!selectable}
      onPress={onPress}
      style={shared.option}
      testID={`provider-option-${index}`}
    >
      <View style={shared.icon}>
        <AppSymbol
          name={option.privacyBoundary === 'on-device' ? 'sparkles' : 'brain'}
          color={appColors.primaryText}
        />
      </View>
      <View style={shared.copy}>
        <Text style={shared.title}>{option.displayName}</Text>
        <Text style={shared.detail}>
          {option.privacyBoundary === 'on-device'
            ? t('modelSettings.localProcessing')
            : option.provider.id === APPLE_PCC_PROVIDER_ID
              ? t('provider.pcc.processing')
              : option.modelId}
        </Text>
        {blockedMessage ? (
          <Text accessibilityRole="alert" style={styles.unavailable}>
            {blockedMessage}
          </Text>
        ) : null}
      </View>
      <AppSymbol
        name={selected ? 'checkmark.circle.fill' : 'circle'}
        color={appColors.text}
      />
    </Pressable>
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

const styles = StyleSheet.create({
  unavailable: { color: appColors.danger },
});
