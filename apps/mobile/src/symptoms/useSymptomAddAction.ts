import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';

/** The list publishes Add only while its editor is closed. */
export function useSymptomAddAction(
  visible: boolean,
  disabled: boolean,
  onPress: () => void,
) {
  const label = t('symptoms.journal.add');
  return useNavigationRouteActions(
    visible
      ? [
          {
            id: 'add-symptom',
            label,
            accessibilityLabel: label,
            testID: 'symptom-add',
            systemImageName: 'plus',
            disabled,
            onPress,
          },
        ]
      : [],
  );
}
