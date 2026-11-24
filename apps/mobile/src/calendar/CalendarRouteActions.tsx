import { BottomNavigationMenu } from '../navigation/BottomNavigationMenu';
import { navigationText } from '../i18n/navigation';

export function CalendarRouteActions({
  onBack,
  onOpenRecording,
  disabled,
}: {
  readonly onBack?: () => void;
  readonly onOpenRecording?: () => void;
  readonly disabled: boolean;
}) {
  if (!onBack) return null;
  return (
    <BottomNavigationMenu
      onBack={onBack}
      primaryAction={
        onOpenRecording
          ? {
              label: navigationText.recording.label,
              accessibilityLabel: navigationText.recording.accessibilityLabel,
              onPress: onOpenRecording,
              testID: 'navigation-recording',
              systemImageName: 'mic',
            }
          : undefined
      }
      testID="calendar-back"
      disabled={disabled}
    />
  );
}
