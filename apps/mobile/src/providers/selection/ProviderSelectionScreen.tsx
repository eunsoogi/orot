import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { AppButton as Button } from '../../layout/AppButton';
import { AppText as Text } from '../../layout/AppText';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { navigationText } from '../../i18n/navigation';
import ChatGPTAccountSetupCard from './ChatGPTAccountSetupCard';
import { ProviderSelectionChoices } from './ProviderSelectionChoices';
import { ProviderSelectionFooter } from './ProviderSelectionFooter';
import { providerSelectionScreenStyles as styles } from './providerSelectionScreenPresentation';
import { resolveProviderSelection } from './providerSelection';
import { providerSelectionText } from './text';
import type { ProviderSelectionScreenNavigationState } from './providerSelectionNavigationState';
import { useProviderSelectionNavigationState } from './providerSelectionNavigationState';
import type {
  ChatGPTAccountSetup,
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionPresentation,
  ProviderSelectionRequirements,
  ProviderSelectionStore,
} from './types';

interface ProviderSelectionScreenProps {
  readonly presentation?: ProviderSelectionPresentation;
  readonly screenTitle?: string;
  readonly screenIntroduction?: string;
  readonly navigationRouteKey?: string;
  readonly options: readonly ProviderSelectionOption[];
  readonly requirements: ProviderSelectionRequirements;
  readonly selectionStore: ProviderSelectionStore;
  readonly chatGPTSetup?: ChatGPTAccountSetup;
  readonly onBack?: () => void;
  readonly onSelectionCommitted?: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
  readonly onNavigationStateChange?: (
    state: ProviderSelectionScreenNavigationState,
  ) => void;
}

export default function ProviderSelectionScreen({
  presentation = 'feature',
  screenTitle,
  screenIntroduction,
  navigationRouteKey,
  options,
  requirements,
  selectionStore,
  chatGPTSetup,
  onBack,
  onSelectionCommitted,
  onNavigationStateChange,
}: ProviderSelectionScreenProps) {
  const navigationInset = useNavigationContentInset();
  const [savedSelection, setSavedSelection] =
    useState<ProviderSelection | null>(null);
  const [pendingOption, setPendingOption] =
    useState<ProviderSelectionOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const publishNavigationState = useProviderSelectionNavigationState(
    onNavigationStateChange,
  );

  useEffect(() => {
    let mounted = true;
    selectionStore
      .load()
      .then(selection => {
        if (mounted) setSavedSelection(selection);
      })
      .catch(() => {
        if (mounted) setLoadError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectionStore]);

  const resolution = useMemo(
    () => resolveProviderSelection(savedSelection, options, requirements),
    [savedSelection, options, requirements],
  );
  const selectedOption = resolution.ok
    ? options.find(
        option =>
          option.provider.id === savedSelection?.providerId &&
          option.modelId === savedSelection?.modelId,
      )
    : undefined;
  const pendingSelection = pendingOption
    ? { providerId: pendingOption.provider.id, modelId: pendingOption.modelId }
    : null;
  // Availability may change while the user is reviewing the remote disclosure.
  const pendingResolution = pendingSelection
    ? resolveProviderSelection(pendingSelection, options, requirements)
    : null;
  const currentPendingOption = pendingSelection
    ? options.find(
        option =>
          option.provider.id === pendingSelection.providerId &&
          option.modelId === pendingSelection.modelId,
      )
    : undefined;
  const confirmationOption = currentPendingOption ?? pendingOption;

  async function confirmSelection() {
    if (!pendingOption || saving) return;
    const selection = {
      providerId: pendingOption.provider.id,
      modelId: pendingOption.modelId,
    };
    // Revalidate in the handler too so a stale render cannot commit a blocked provider.
    const currentResolution = resolveProviderSelection(
      selection,
      options,
      requirements,
    );
    if (!currentResolution.ok) return;
    publishNavigationState({
      hasPendingSelection: true,
      isSavingSelection: true,
    });
    setSaving(true);
    setSaveError(false);
    let selectionSaved = false;
    try {
      await selectionStore.save(selection);
      setSavedSelection(selection);
      setPendingOption(null);
      selectionSaved = true;
      publishNavigationState(
        { hasPendingSelection: false, isSavingSelection: false },
        true,
      );
      setSaving(false);
      // Loading a saved choice never routes a provider; only explicit confirmation does.
      onSelectionCommitted?.(selection, currentResolution.provider);
    } catch {
      setSaveError(true);
    } finally {
      if (!selectionSaved) {
        publishNavigationState({
          hasPendingSelection: true,
          isSavingSelection: false,
        });
      }
      setSaving(false);
    }
  }

  const selectionMessage = loading
    ? ''
    : loadError
      ? providerSelectionText.storageLoadError
      : resolution.ok
        ? `${providerSelectionText.selectedPrefix} ${selectedOption?.displayName ?? ''}`
        : savedSelection
          ? providerSelectionText.unavailableSelection
          : providerSelectionText.selectPrompt;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          presentation === 'settings-accounts' && navigationInset,
        ]}
        style={styles.scrollView}
        testID={
          presentation === 'settings-provider'
            ? 'settings-provider-screen'
            : presentation === 'settings-accounts'
              ? 'settings-accounts-screen'
              : 'provider-selection-screen'
        }
      >
        {onBack && !navigationRouteKey ? (
          <Button
            accessibilityLabel={navigationText.back.accessibilityLabel}
            onPress={onBack}
            testID="provider-selection-back"
            title={navigationText.back.label}
          />
        ) : null}
        {/* AI keeps combined controls; Settings exposes provider choices or account actions by route. */}
        <Text accessibilityRole="header" style={styles.title}>
          {presentation === 'feature'
            ? 'AI 선택'
            : (screenTitle ?? providerSelectionText.title)}
        </Text>
        <Text style={styles.introduction}>
          {presentation === 'feature'
            ? '질문에 답할 AI를 선택해 주세요.'
            : (screenIntroduction ?? providerSelectionText.introduction)}
        </Text>
        {chatGPTSetup && presentation === 'settings-accounts' ? (
          <ChatGPTAccountSetupCard setup={chatGPTSetup} />
        ) : null}
        {presentation !== 'settings-accounts' ? (
          <ProviderSelectionChoices
            chatGPTSetup={chatGPTSetup}
            loading={loading}
            onChoose={option => {
              publishNavigationState(
                { hasPendingSelection: true, isSavingSelection: false },
                true,
              );
              setPendingOption(option);
              setSaveError(false);
            }}
            options={options}
            pendingOption={pendingOption}
            presentation={presentation}
            requirements={requirements}
            saving={saving}
            selectedOption={selectedOption}
          />
        ) : null}
      </ScrollView>
      {presentation !== 'settings-accounts' ? (
        <ProviderSelectionFooter
          message={selectionMessage}
          saveError={saveError}
          remoteAvailable={options.some(
            option => option.privacyBoundary !== 'on-device',
          )}
          resolution={pendingResolution}
          onCancel={() => {
            publishNavigationState(
              { hasPendingSelection: false, isSavingSelection: false },
              true,
            );
            setPendingOption(null);
          }}
          onConfirm={confirmSelection}
          option={pendingOption ? confirmationOption : null}
          saving={saving}
        />
      ) : null}
    </View>
  );
}
