import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
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

/** Keeps selection state in the parent while settings reflows local and connected providers. */
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
      (option.privacyBoundary === 'on-device') === local ? (
        <ProviderSelectionOptionCard
          key={`${option.provider.id}:${option.modelId}`}
          disabled={loading || saving}
          index={index}
          onPress={() => onChoose(option)}
          option={option}
          requirements={requirements}
          showCapabilities={presentation === 'settings-provider'}
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
          : undefined
      }
    >
      <Text style={styles.heading}>이 기기에서</Text>
      {cards(true)}
    </View>
  );
  const showConnectedPanel =
    chatGPTSetup !== undefined ||
    options.some(option => option.privacyBoundary !== 'on-device');
  const connectedPanel = showConnectedPanel ? (
    <View
      style={styles.section}
      testID={
        presentation === 'settings-provider'
          ? 'settings-provider-connected-panel'
          : undefined
      }
    >
      <Text style={styles.heading}>연결한 계정</Text>
      <View style={styles.account}>
        {chatGPTSetup ? <ProviderCatalogAccount setup={chatGPTSetup} /> : null}
        {cards(false)}
      </View>
    </View>
  ) : null;

  if (presentation === 'settings-provider') {
    // The route-level owner removes the scene width clamp so both panels see the same native regions.
    return (
      <AdaptiveColumns
        primary={localPanel}
        secondary={connectedPanel}
        testID="settings-provider-panels"
      />
    );
  }

  return (
    <>
      {localPanel}
      {connectedPanel}
    </>
  );
}
const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 22 },
  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: appColors.text,
    paddingHorizontal: 4,
  },
  account: {
    gap: 8,
    padding: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
  },
});
