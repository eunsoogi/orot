import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

/** Hide Add while the retained appointment editor owns the action dock. */
export function useAppointmentAddAction(
  visible: boolean,
  disabled: boolean,
  onPress: () => void,
) {
  const label = t('appointments.actions.add');
  return useNavigationRouteActions(
    visible
      ? [
          {
            id: 'add-appointment',
            label,
            accessibilityLabel: label,
            testID: 'appointment-add',
            systemImageName: 'plus',
            disabled,
            onPress,
          },
        ]
      : [],
  );
}
