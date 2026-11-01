import { StyleSheet, View } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { reviewCopy as copy } from './strings';
import type { ReviewState } from './controller';

/** Publishes only review decisions; consent and candidate editing remain with their owner. */
export function EncounterReviewActions({
  status,
  hasPending,
  disabled,
  saveDisabled,
  onStart,
  onSave,
  onDeny,
  onRestore,
  onCancel,
}: {
  status: ReviewState['status'];
  hasPending: boolean;
  disabled: boolean;
  saveDisabled: boolean;
  onStart: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onDeny: () => void | Promise<void>;
  onRestore: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const busy = ['loading', 'running', 'saving'].includes(status);
  const actions = hasPending
    ? [
        {
          id: 'save-encounter',
          label: copy.save,
          testID: 'encounter-save',
          systemImageName: 'checkmark',
          disabled: saveDisabled,
          onPress: onSave,
        },
        {
          id: 'deny-encounter',
          label: copy.deny,
          testID: 'encounter-deny',
          systemImageName: 'xmark',
          disabled,
          onPress: onDeny,
        },
      ]
    : busy && status !== 'loading'
      ? [
          {
            id: 'cancel-encounter',
            label: copy.cancel,
            testID: 'encounter-cancel',
            systemImageName: 'xmark',
            disabled: false,
            onPress: onCancel,
          },
        ]
      : !busy
        ? [
            {
              id: 'start-encounter',
              label:
                status === 'idle' || status === 'no-transcript'
                  ? copy.start
                  : copy.restart,
              testID: 'encounter-start',
              systemImageName: 'sparkles',
              disabled,
              onPress: onStart,
            },
            ...(['cancelled', 'unavailable'].includes(status)
              ? [
                  {
                    id: 'restore-encounter',
                    label: copy.restore,
                    testID: 'encounter-restore',
                    systemImageName: 'arrow.uturn.backward',
                    disabled,
                    onPress: onRestore,
                  },
                ]
              : []),
          ]
        : [];
  const hasDock = useNavigationRouteActions(
    actions.map(action => ({ ...action, accessibilityLabel: action.label })),
  );
  if (hasDock) return null;
  return (
    <View style={styles.actions}>
      {actions.map(action => (
        <AppButton
          key={action.id}
          title={action.label}
          disabled={action.disabled}
          onPress={
            action.id === 'start-encounter'
              ? () => {
                  action.onPress();
                }
              : action.onPress
          }
          testID={action.testID}
          variant={
            [
              'deny-encounter',
              'restore-encounter',
              'cancel-encounter',
            ].includes(action.id)
              ? 'secondary'
              : undefined
          }
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ actions: { gap: 12 } });
