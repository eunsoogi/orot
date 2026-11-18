import { SettingsSearchConsentChoices } from '../../agent/execution/SettingsSearchConsentChoices';
import type { SettingsSearchChoices } from '../../agent/execution/settingsSearchGrants';
import { settingsConsentRecipient } from '../../agent/execution/settingsConsentRecipient';
import { t } from '../../i18n';
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
  searchChoices,
  onSearchChoices,
}: {
  readonly option: ProviderSelectionOption | null | undefined;
  readonly resolution: ProviderSelectionResolution | null;
  readonly saving: boolean;
  readonly message: string;
  readonly saveError: boolean;
  readonly remoteAvailable: boolean;
  readonly searchChoices?: SettingsSearchChoices;
  readonly onSearchChoices?: (value: SettingsSearchChoices) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const hasDock = useNavigationRouteActions([
    {
      id: 'confirm-provider',
      label: t('modelSettings.confirmLanguage'),
      accessibilityLabel: t('modelSettings.confirmLanguage'),
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
          consentChoices={
            searchChoices && onSearchChoices ? (
              <SettingsSearchConsentChoices
                value={searchChoices}
                onChange={onSearchChoices}
                disabled={saving}
                webRecipient={
                  option.provider.searchPublicWeb
                    ? t('externalMedicalEvidence.publicSearchRecipient', {
                        recipient:
                          settingsConsentRecipient(option.provider.id) ?? '',
                      })
                    : undefined
                }
              />
            ) : null
          }
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
          {!hasDock ? (
            <Button disabled title={t('modelSettings.confirmLanguage')} />
          ) : null}
        </>
      )}
    </View>
  );
}
