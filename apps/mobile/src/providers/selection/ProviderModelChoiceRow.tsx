import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { AppSymbol } from '../../layout/AppSymbol';
import { providerSettingsStyles as shared } from '../../layout/providerSettingsPresentation';
import { appColors } from '../../layout/appColors';

/** Present a choice without inventing a provider or inheriting another chooser's authorization. */
export function ProviderModelChoiceRow({
  testID,
  title,
  detail,
  icon = 'brain',
  blockedMessage,
  selected,
  disabled,
  onPress,
}: {
  readonly testID: string;
  readonly title: string;
  readonly detail?: string;
  readonly icon?: 'sparkles' | 'brain' | 'wrench.and.screwdriver';
  readonly blockedMessage?: string | null;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={shared.option}
      testID={testID}
    >
      <View style={shared.icon}>
        <AppSymbol name={icon} color={appColors.primaryText} />
      </View>
      <View style={shared.copy}>
        <Text style={shared.title}>{title}</Text>
        {detail !== undefined ? (
          <Text style={shared.detail}>{detail}</Text>
        ) : null}
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

const styles = StyleSheet.create({ unavailable: { color: appColors.danger } });
