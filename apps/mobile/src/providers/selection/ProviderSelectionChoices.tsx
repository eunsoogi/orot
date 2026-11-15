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
      (option.privacyBoundary === 'on-device') === local ? (
        <ProviderSelectionOptionCard
          key={`${option.provider.id}:${option.modelId}`}
          disabled={loading || saving}
          index={index}
          onPress={() => onChoose(option)}
          option={option}
          requirements={requirements}
          showCapabilities={
            presentation === 'feature' || presentation === 'settings-provider'
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
          : 'provider-selection-connected-panel'
      }
    >
      <Text accessibilityRole="header" style={styles.heading}>
        ChatGPT
      </Text>
      <Text>
        이 계정에서 조회한 대화 모델입니다. OpenAI API 연결과 별개이며 구독에
        API 사용 요금이나 크레딧이 포함되지는 않습니다.
      </Text>
      <View style={styles.account}>
        {chatGPTSetup ? <ProviderCatalogAccount setup={chatGPTSetup} /> : null}
        {cards(false)}
      </View>
    </View>
  ) : null;

  if (presentation === 'settings-provider' || presentation === 'feature') {
    // Both sections stay in one measured region and retain their screen-owned selection state.
    return (
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
    );
  }

  return (
    <>
      {localPanel}
      {connectedPanel}
    </>
  );
}
