import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

/** One stable dock action for the paired OpenAI form and the existing local voice picker. */
export function useVoiceSettingsRouteSave({
  active,
  label,
  disabled,
  busy,
  onPress,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly onPress: () => void;
}) {
  return useNavigationRouteActions(
    [
      {
        id: 'confirm-voice-model',
        label,
        accessibilityLabel: label,
        testID: 'voice-settings-save',
        systemImageName: 'checkmark',
        disabled,
        busy,
        onPress,
      },
    ],
    active,
  );
}
