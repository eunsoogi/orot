import { t } from '../../i18n';
import { APPLE_PCC_PROVIDER_ID } from './privateCloudCompute';
import { View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { providerSettingsStyles as styles } from '../../layout/providerSettingsPresentation';
import { AdaptiveColumns } from '../../layout/AdaptiveColumns';
import { ProviderCatalogAccount } from './ProviderCatalogAccount';
import ProviderSelectionOptionCard from './ProviderSelectionOptionCard';
import type {
  ProviderSelectionOption,
  ChatGPTAccountSetup,
  ProviderSelectionPresentation,
  ProviderSelectionRequirements,
} from './types';

interface ProviderSelectionChoicesProps {
  readonly options: readonly ProviderSelectionOption[];
  readonly loading: boolean;
  readonly saving: boolean;
  readonly selectedOption: ProviderSelectionOption | undefined;
  readonly pendingOption: ProviderSelectionOption | null;
  readonly requirements: ProviderSelectionRequirements;
  readonly presentation?: ProviderSelectionPresentation;
  readonly onChoose: (option: ProviderSelectionOption) => void;
  readonly chatGPTSetup?: ChatGPTAccountSetup;
}

/** Name the local and subscription boundaries without changing screen-owned selection. */
export function ProviderSelectionChoices({
  options,
  loading,
  saving,
  selectedOption,
  pendingOption,
  requirements,
  presentation = 'feature',
  onChoose,
  chatGPTSetup,
}: ProviderSelectionChoicesProps) {
  const selected = pendingOption ?? selectedOption;
  const cards = (local: boolean) =>
    options.map((option, index) =>
      (option.privacyBoundary === 'on-device' ||
        option.provider.id === APPLE_PCC_PROVIDER_ID) === local ? (
        <ProviderSelectionOptionCard
          key={`${option.provider.id}:${option.modelId}`}
          disabled={loading || saving}
          index={index}
          onPress={() => onChoose(option)}
          option={option}
          requirements={requirements}
          showCapabilities={
            presentation === 'feature' ||
            (presentation === 'settings-provider' && !local)
          }
          selected={
            selected?.provider.id === option.provider.id &&
            selected.modelId === option.modelId
          }
        />
      ) : null,
    );
  const localPanel = (
    <View
      style={styles.section}
      testID={
        presentation === 'settings-provider'
          ? 'settings-provider-local-panel'
          : 'provider-selection-local-panel'
      }
    >
      <Text accessibilityRole="header" style={styles.heading}>
        Apple
      </Text>
      {cards(true)}
      {options.some(option => option.provider.id === APPLE_PCC_PROVIDER_ID) ? (
        <Text>{t('provider.pcc.privacy')}</Text>
      ) : null}
    </View>
  );
  const showConnectedPanel =
    chatGPTSetup !== undefined ||
    options.some(
      option =>
        option.privacyBoundary !== 'on-device' &&
        option.provider.id !== APPLE_PCC_PROVIDER_ID,
    );
  const connectedPanel = showConnectedPanel ? (
    <View
      style={styles.section}
      testID={
        presentation === 'settings-provider'
          ? 'settings-provider-connected-panel'
          : 'provider-selection-connected-panel'
      }
    >
      <Text accessibilityRole="header" style={styles.heading}>
        ChatGPT
      </Text>
      <Text>{t('modelSettings.subscriptionNotice')}</Text>
      <View style={styles.account}>
        {chatGPTSetup ? <ProviderCatalogAccount setup={chatGPTSetup} /> : null}
        {cards(false)}
      </View>
    </View>
  ) : null;

  if (presentation === 'settings-provider' || presentation === 'feature') {
    // A content-sized wrapper keeps the measured catalog from pushing its summary to the bottom.
    return (
      <View testID="provider-choices-content">
        <AdaptiveColumns
          primary={
            <View>
              {localPanel}
              {connectedPanel}
            </View>
          }
          testID={
            presentation === 'settings-provider'
              ? 'settings-provider-panels'
              : 'provider-selection-feature-panels'
          }
        />
      </View>
    );
  }

  return (
    <>
      {localPanel}
      {connectedPanel}
    </>
  );
}
