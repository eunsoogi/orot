import { StyleSheet, View } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { appColors } from '../../layout/appColors';
import { ProviderCatalogAccount } from './ProviderCatalogAccount';
import ProviderSelectionOptionCard from './ProviderSelectionOptionCard';
import type {
  ProviderSelectionOption,
  ChatGPTAccountSetup,
  ProviderSelectionRequirements,
} from './types';

interface ProviderSelectionChoicesProps {
  readonly options: readonly ProviderSelectionOption[];
  readonly loading: boolean;
  readonly saving: boolean;
  readonly selectedOption: ProviderSelectionOption | undefined;
  readonly pendingOption: ProviderSelectionOption | null;
  readonly requirements: ProviderSelectionRequirements;
  readonly onChoose: (option: ProviderSelectionOption) => void;
  readonly chatGPTSetup?: ChatGPTAccountSetup;
}

/** Keeps provider cards and their explicit privacy confirmation together. */
export function ProviderSelectionChoices({
  options,
  loading,
  saving,
  selectedOption,
  pendingOption,
  requirements,
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
          selected={
            selected?.provider.id === option.provider.id &&
            selected.modelId === option.modelId
          }
        />
      ) : null,
    );
  return (
    <>
      <View style={styles.section}>
        <Text style={styles.heading}>이 기기에서</Text>
        {cards(true)}
      </View>
      {chatGPTSetup ||
      options.some(option => option.privacyBoundary !== 'on-device') ? (
        <View style={styles.section}>
          <Text style={styles.heading}>연결한 계정</Text>
          <View style={styles.account}>
            {chatGPTSetup ? (
              <ProviderCatalogAccount setup={chatGPTSetup} />
            ) : null}
            {cards(false)}
          </View>
        </View>
      ) : null}
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
