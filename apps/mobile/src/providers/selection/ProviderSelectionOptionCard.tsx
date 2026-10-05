import { Pressable, StyleSheet, Text } from 'react-native';
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
  const blockedMessage = getBlockedMessage(option, requirements);
  const selectable = blockedMessage === null && !disabled;
  const privacyText =
    option.privacyBoundary === 'on-device'
      ? providerSelectionText.onDevicePrivacy
      : providerSelectionText.remotePrivacy;

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
      <Text style={styles.optionTitle}>{option.displayName}</Text>
      <Text style={styles.privacyHeading}>
        {option.privacyBoundary === 'on-device'
          ? providerSelectionText.onDeviceHeading
          : providerSelectionText.remoteHeading}
      </Text>
      <Text>{privacyText}</Text>
      {blockedMessage ? (
        <Text accessibilityRole="alert" style={styles.unavailable}>
          {blockedMessage}
        </Text>
      ) : null}
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
  option: {
    gap: 6,
    padding: 16,
    borderColor: '#9aa7b2',
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  selectedOption: { borderColor: '#1769aa', borderWidth: 2 },
  optionTitle: { color: '#17212b', fontSize: 18, fontWeight: '600' },
  privacyHeading: { color: '#293847', fontWeight: '600' },
  unavailable: { color: '#9a3412' },
});
