import { ModelSelectionSummary } from '../../layout/ModelSelectionSummary';
import { View } from 'react-native';
import { AppButton as Button } from '../../layout/AppButton';
import { AppText as Text } from '../../layout/AppText';
import ProviderSelectionConfirmation from './ProviderSelectionConfirmation';
import {
  providerSelectionScreenStyles as styles,
  resolutionMessage,
} from './providerSelectionScreenPresentation';
import { providerSelectionText } from './text';
import type {
  ProviderSelectionOption,
  ProviderSelectionResolution,
} from './types';
import { useNavigationRouteActions } from '../../navigation/useNavigationRouteActions';

/** Keeps selection, disclosure and final actions in the parent page's continuous scroll flow. */
export function ProviderSelectionFooter({
  option,
  resolution,
  saving,
  message,
  saveError,
  remoteAvailable,
  onConfirm,
  onCancel,
}: {
  readonly option: ProviderSelectionOption | null | undefined;
  readonly resolution: ProviderSelectionResolution | null;
  readonly saving: boolean;
  readonly message: string;
  readonly saveError: boolean;
  readonly remoteAvailable: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const hasDock = useNavigationRouteActions([
    {
      id: 'confirm-provider',
      label: '이 AI 사용',
      accessibilityLabel: '이 AI 사용',
      testID: 'provider-selection-confirm',
      systemImageName: 'checkmark',
      disabled: saving || !option || resolution?.ok !== true,
      busy: saving,
      onPress: onConfirm,
    },
    ...(option
      ? [
          {
            id: 'cancel-provider-selection',
            label: providerSelectionText.cancel,
            accessibilityLabel: providerSelectionText.cancel,
            testID: 'provider-selection-cancel',
            systemImageName: 'xmark',
            disabled: saving,
            onPress: onCancel,
          },
        ]
      : []),
  ]);
  return (
    <View style={styles.footer} testID="provider-selection-footer">
      {saveError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {providerSelectionText.storageSaveError}
        </Text>
      ) : null}
      {option ? (
        <ProviderSelectionConfirmation
          option={option}
          blockedMessage={resolutionMessage(resolution)}
          canConfirm={resolution?.ok === true}
          saving={saving}
          hasActionDock={hasDock}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      ) : (
        <>
          {remoteAvailable ? (
            <Text>{providerSelectionText.remotePrivacy}</Text>
          ) : null}
          <ModelSelectionSummary
            label={
              message.startsWith(providerSelectionText.selectedPrefix)
                ? providerSelectionText.selectedPrefix
                : undefined
            }
            value={
              message.startsWith(providerSelectionText.selectedPrefix)
                ? message
                    .slice(providerSelectionText.selectedPrefix.length)
                    .trimStart()
                : message
            }
            testID="provider-selection-current"
          />
          {!hasDock ? <Button disabled title="이 AI 사용" /> : null}
        </>
      )}
    </View>
  );
}
