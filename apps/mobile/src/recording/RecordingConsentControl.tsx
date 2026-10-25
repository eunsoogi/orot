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
      style={[
        recordingControlStyles.consentRow,
        checked && recordingControlStyles.consentSelected,
      ]}
      testID="recording-consent"
    >
      {/* A checkmark and explicit state distinguish consent without depending only on color. */}
      <View
        style={recordingControlStyles.consentIndicator}
        testID="recording-consent-indicator"
      >
        <AppSymbol
          name={checked ? 'checkmark.circle.fill' : 'circle'}
          size={32}
          color={checked ? appColors.primaryText : appColors.secondary}
        />
      </View>
      <View style={recordingControlStyles.consentCopy}>
        <Text style={recordingControlStyles.consentTitle}>
          {t('recording.consent.acknowledgement')}
        </Text>
        <Text
          style={
            checked
              ? recordingControlStyles.consentCheckedText
              : recordingControlStyles.copy
          }
          testID="recording-consent-status"
        >
          {t(
            checked
              ? 'recording.consent.checked'
              : 'recording.consent.unchecked',
          )}
        </Text>
      </View>
    </Pressable>
  );
}
