import { useContext } from 'react';
import { APPLE_PCC_PROVIDER_ID } from './privateCloudCompute';
import { View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { providerSettingsStyles as styles } from '../../layout/providerSettingsPresentation';
import { AdaptiveColumns } from '../../layout/AdaptiveColumns';
import { AdaptiveColumnsMeasurementRoot } from '../../layout/AdaptiveColumnsMeasurementRoot';
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
  readonly preferredProviderId?: string;
  readonly cachedOptions?: readonly ProviderSelectionOption[];
  readonly selectedOption: ProviderSelectionOption | undefined;
  readonly pendingOption: ProviderSelectionOption | null;
  readonly requirements: ProviderSelectionRequirements;
  readonly presentation?: ProviderSelectionPresentation;
  readonly followsSiblingSummary?: boolean;
  readonly onChoose: (option: ProviderSelectionOption) => void;
  readonly chatGPTSetup?: ChatGPTAccountSetup;
}

/** Name the local and subscription boundaries without changing screen-owned selection. */
export function ProviderSelectionChoices({
  options,
  loading,
  saving,
  selectedOption,
  preferredProviderId,
  cachedOptions = [],
  pendingOption,
  requirements,
  presentation = 'feature',
  followsSiblingSummary = false,
  onChoose,
  chatGPTSetup,
}: ProviderSelectionChoicesProps) {
  const modelTabViewport = useContext(AdaptiveColumnsMeasurementRoot);
  const selected = pendingOption ?? selectedOption;
  const preferred =
    preferredProviderId ??
    (presentation === 'settings-provider'
      ? selectedOption?.provider.id
      : undefined);
  const connectedFirst =
    preferred?.startsWith('chatgpt-plan:') ||
    options.some(
      option =>
        option.provider.id === preferred &&
        option.privacyBoundary !== 'on-device' &&
        option.provider.id !== APPLE_PCC_PROVIDER_ID,
    );
  const readOnly = cachedOptions.filter(
    cached =>
      !options.some(option => option.provider.id === cached.provider.id),
  );
  const cards = (local: boolean) =>
    [...options, ...readOnly].map((option, index) =>
      (option.privacyBoundary === 'on-device' ||
        option.provider.id === APPLE_PCC_PROVIDER_ID) === local ? (
        <ProviderSelectionOptionCard
          key={`${option.provider.id}:${option.modelId}`}
          disabled={loading || saving || readOnly.includes(option)}
          presentationOnly={readOnly.includes(option)}
          index={index}
          onPress={() => onChoose(option)}
          option={option}
          hideLocalSubtitle={presentation === 'settings-provider'}
          requirements={requirements}
          selected={
            selected?.provider.id === option.provider.id &&
            selected.modelId === option.modelId
          }
        />
      ) : null,
    );
  const localPanel = (
    <View
      style={[
        styles.section,
        followsSiblingSummary && styles.firstSectionAfterSiblingSummary,
      ]}
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
    </View>
  );
  const showConnectedPanel =
    chatGPTSetup !== undefined ||
    readOnly.length > 0 ||
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
      <View style={styles.catalogAccount}>
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
          // Both settings catalog wrappers stretch to the tab viewport without horizontal padding.
          measurementRoot={
            presentation === 'settings-provider' ? modelTabViewport : null
          }
          primary={
            <View>
              {connectedFirst ? connectedPanel : localPanel}
              {connectedFirst ? localPanel : connectedPanel}
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
      {connectedFirst ? connectedPanel : localPanel}
      {connectedFirst ? localPanel : connectedPanel}
    </>
  );
}
