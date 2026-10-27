import { AppText as Text } from '../../layout/AppText';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppSymbol } from '../../layout/AppSymbol';
import { appColors } from '../../layout/appColors';
import type { ProviderInputType } from '@orot/model-runtime';
import { isProviderSelectionOptionSelectable } from './providerSelection';
import { providerSelectionText } from './text';
import type {
  ProviderSelectionOption,
  ProviderSelectionRequirements,
} from './types';

interface ProviderSelectionOptionCardProps {
  readonly option: ProviderSelectionOption;
  readonly requirements: ProviderSelectionRequirements;
  readonly showCapabilities: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly index: number;
  readonly onPress: () => void;
}

export default function ProviderSelectionOptionCard({
  option,
  requirements,
  showCapabilities,
  selected,
  disabled,
  index,
  onPress,
}: ProviderSelectionOptionCardProps) {
  const blockedMessage = getBlockedMessage(option, requirements);
  const capabilityLabels = showCapabilities ? getCapabilityLabels(option) : [];
  const selectable = blockedMessage === null && !disabled;
  return (
    <Pressable
      key={`${option.provider.id}:${option.modelId}`}
      accessibilityRole="radio"
      accessibilityState={{ disabled: !selectable, selected }}
      disabled={!selectable}
      onPress={onPress}
      style={[styles.option, selected && styles.selectedOption]}
      testID={`provider-option-${index}`}
    >
      <View style={styles.icon}>
        <AppSymbol
          name={option.privacyBoundary === 'on-device' ? 'sparkles' : 'brain'}
          size={28}
          color={appColors.primaryText}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.optionTitle}>{option.displayName}</Text>
        <Text style={styles.privacyHeading}>
          {option.privacyBoundary === 'on-device'
            ? '기기 안에서 처리'
            : option.modelId}
        </Text>
        {showCapabilities ? (
          <Text
            style={styles.capabilities}
            testID={`provider-option-${index}-capabilities`}
          >
            {`${providerSelectionText.capabilitiesSummary}: ${capabilityLabels.length > 0 ? capabilityLabels.join(' · ') : providerSelectionText.noDeclaredCapabilities}`}
          </Text>
        ) : null}
        {blockedMessage ? (
          <Text accessibilityRole="alert" style={styles.unavailable}>
            {blockedMessage}
          </Text>
        ) : null}
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

/** Exposes only adapter-declared features because this catalog has no per-model capability metadata. */
function getCapabilityLabels(option: ProviderSelectionOption): string[] {
  const capabilities = option.provider.capabilities;
  return [
    ...capabilities.inputTypes.map(
      (inputType: ProviderInputType) =>
        providerSelectionText.capabilityInput[inputType],
    ),
    ...(capabilities.streaming
      ? [providerSelectionText.capabilityStreaming]
      : []),
    ...(capabilities.structuredOutput
      ? [providerSelectionText.capabilityStructuredOutput]
      : []),
    ...(capabilities.toolCalling
      ? [providerSelectionText.capabilityToolCalling]
      : []),
  ];
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
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 82,
    padding: 16,
    borderColor: appColors.border,
    borderWidth: 1,
    borderRadius: 20,
    backgroundColor: appColors.surface,
  },
  selectedOption: {
    borderColor: appColors.primary,
    backgroundColor: appColors.primarySoft,
  },
  copy: { flex: 1, gap: 6 },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: appColors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: appColors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: appColors.primaryAction,
    backgroundColor: appColors.primaryAction,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: appColors.onPrimary,
  },
  optionTitle: { color: appColors.text, fontSize: 18, fontWeight: '600' },
  privacyHeading: { color: appColors.secondary, fontSize: 14 },
  capabilities: { color: appColors.secondary, fontSize: 13, flexWrap: 'wrap' },
  unavailable: { color: appColors.danger },
});
