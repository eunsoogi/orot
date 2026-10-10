import { Pressable } from 'react-native';
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
      accessibilityState={{ checked: checked }}
      disabled={disabled}
      onPress={onPress}
      style={recordingControlStyles.consentRow}
      testID="recording-consent"
    >
      <Text style={recordingControlStyles.checkbox}>{checked ? '☑' : '☐'}</Text>
      <Text style={recordingControlStyles.copy}>
        {t('recording.consent.acknowledgement')}
      </Text>
    </Pressable>
  );
}
