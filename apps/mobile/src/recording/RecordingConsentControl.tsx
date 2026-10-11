import { Pressable, View } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { recordingControlStyles } from './RecordingControls.styles';

/** Recording consent cannot change while a recording is active or a save is pending. */
export function RecordingConsentControl({
  checked,
  disabled,
  onPress,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={recordingControlStyles.consentRow}
      testID="recording-consent"
    >
      <View testID="recording-consent-indicator">
        <AppSymbol
          name={checked ? 'checkmark.circle.fill' : 'circle'}
          size={24}
          color={checked ? appColors.primary : appColors.secondary}
        />
      </View>
      <Text style={recordingControlStyles.copy}>
        {t('recording.consent.acknowledgement')}
      </Text>
    </Pressable>
  );
}
