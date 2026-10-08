import { useEffect, useMemo, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text } from 'react-native';
import ProviderSelectionConfirmation from './ProviderSelectionConfirmation';
import ProviderSelectionOptionCard from './ProviderSelectionOptionCard';
import ChatGPTAccountSetupCard from './ChatGPTAccountSetupCard';
import { resolveProviderSelection } from './providerSelection';
import { providerSelectionText } from './text';
import type { ProviderSelectionScreenNavigationState } from './providerSelectionNavigationState';
import { useProviderSelectionNavigationState } from './providerSelectionNavigationState';
import type {
  ChatGPTAccountSetup,
  ProviderSelection,
  ProviderSelectionOption,
  ProviderSelectionRequirements,
  ProviderSelectionResolution,
  ProviderSelectionStore,
} from './types';

interface ProviderSelectionScreenProps {
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
  options,
  requirements,
  selectionStore,
  chatGPTSetup,
  onBack,
  onSelectionCommitted,
  onNavigationStateChange,
}: ProviderSelectionScreenProps) {
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
    <ScrollView
      contentContainerStyle={styles.container}
      style={styles.scrollView}
      testID="provider-selection-screen"
    >
      {onBack ? (
        <Button
          onPress={onBack}
          testID="provider-selection-back"
          title={providerSelectionText.chatGPTBack}
        />
      ) : null}
      <Text accessibilityRole="header" style={styles.title}>
        {providerSelectionText.title}
      </Text>
      <Text style={styles.introduction}>
        {providerSelectionText.introduction}
      </Text>
      <Text
        accessibilityRole={loadError || saveError ? 'alert' : undefined}
        testID="provider-selection-current"
      >
        {saveError ? providerSelectionText.storageSaveError : selectionMessage}
      </Text>
      {chatGPTSetup ? <ChatGPTAccountSetupCard setup={chatGPTSetup} /> : null}

      {options.map((option, index) => (
        <ProviderSelectionOptionCard
          key={`${option.provider.id}:${option.modelId}`}
          disabled={loading || saving}
          index={index}
          onPress={() => {
            publishNavigationState(
              { hasPendingSelection: true, isSavingSelection: false },
              true,
            );
            setPendingOption(option);
            setSaveError(false);
          }}
          option={option}
          requirements={requirements}
          selected={
            selectedOption?.provider.id === option.provider.id &&
            selectedOption.modelId === option.modelId
          }
        />
      ))}

      {pendingOption && confirmationOption ? (
        <ProviderSelectionConfirmation
          blockedMessage={resolutionMessage(pendingResolution)}
          canConfirm={pendingResolution?.ok === true}
          onCancel={() => {
            publishNavigationState(
              { hasPendingSelection: false, isSavingSelection: false },
              true,
            );
            setPendingOption(null);
          }}
          onConfirm={confirmSelection}
          option={confirmationOption}
          saving={saving}
        />
      ) : null}
    </ScrollView>
  );
}

function resolutionMessage(
  resolution: ProviderSelectionResolution | null,
): string | null {
  if (!resolution || resolution.ok) return null;
  switch (resolution.reason) {
    case 'provider-unavailable':
      return resolution.message ?? providerSelectionText.unavailableProvider;
    case 'missing-capability':
      return providerSelectionText.unsupportedCapabilities;
    case 'selection-required':
    case 'selection-unavailable':
      return providerSelectionText.unavailableSelection;
  }
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  // Account rows and disclosures must remain scrollable in short viewports.
  container: { flexGrow: 1, gap: 12, padding: 24, backgroundColor: '#f7f8fa' },
  title: { color: '#17212b', fontSize: 24, fontWeight: '700' },
  introduction: { color: '#45515f', fontSize: 15 },
});
