import { ProviderSelectionHeading } from './ProviderSelectionHeading';
import { AdaptiveColumns } from '../../layout/AdaptiveColumns';
import { useSavedChatGPTTitle } from './useSavedChatGPTTitle';
import { savedModelPresentation } from './savedModelPresentation';
import { useSavedSearchChoices } from './useSavedSearchChoices';
import { useConversationModelConfirmation } from './useConversationModelConfirmation';
import { APPLE_PCC_PROVIDER_ID } from './privateCloudCompute';
import { ModelSelectionTabs } from './ModelSelectionTabs';
import { useProviderSelectionScrollLane } from './useProviderSelectionScrollLane';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import ChatGPTAccountSetupCard from './ChatGPTAccountSetupCard';
import { ProviderSelectionChoices } from './ProviderSelectionChoices';
import {
  ProviderSelectionCurrentSummary,
  ProviderSelectionFooter,
} from './ProviderSelectionFooter';
import {
  providerSelectionScreenStyles as styles,
  selectionSummaryMessage,
} from './providerSelectionScreenPresentation';
import { resolveProviderSelection } from './providerSelection';
import type { ProviderSelectionScreenProps } from './ProviderSelectionScreenProps';
import { useProviderSelectionNavigationState } from './providerSelectionNavigationState';
import type { ProviderSelection, ProviderSelectionOption } from './types';
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
  const isSettings = presentation !== 'feature';
  const { edge, contentStyle, onLayout } = useProviderSelectionScrollLane(
    Boolean(navigationRouteKey) && isSettings,
    isSettings,
  );
  const search = useSavedSearchChoices(selectionStore);
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
  // Saved identity remains visible even before the account catalog is refreshed.
  const selectedOption = options.find(
    option =>
      option.provider.id === savedSelection?.providerId &&
      option.modelId === savedSelection?.modelId,
  );
  const savedChatGPTTitle = useSavedChatGPTTitle(
    selectionStore,
    savedSelection,
  );
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
  const { unifiedReview, confirmSelection, disclosureSheet } =
    useConversationModelConfirmation({
      presentation,
      navigationRouteKey,
      selectionStore,
      onSelectionCommitted,
      pendingSelection,
      pendingResolution,
      currentPendingOption,
      confirmationOption,
      searchChoices: search.choices,
      saving,
      setSaving,
      setSaveError,
      setSavedSelection,
      setPendingOption,
      publishNavigationState,
    });
  const selectionMessage = selectionSummaryMessage({
    loading,
    loadError,
    available: resolution.ok,
    displayName: selectedOption?.displayName,
    storedLabel:
      savedSelection && presentation === 'settings-provider'
        ? savedModelPresentation(
            savedSelection,
            selectedOption,
            undefined,
            savedChatGPTTitle,
          )
        : undefined,
    savedModelId: savedSelection?.modelId,
    presentation,
  });
  const host = { testID: 'provider-selection-scroll-lane', onLayout };
  const screen = (
    <View style={styles.root} {...host}>
      <ScrollView
        {...edge.indicatorProps}
        contentContainerStyle={contentStyle}
        style={[styles.scrollView, edge.scrollViewStyle]}
        testID={
          presentation.replace('feature', 'provider-selection') + '-screen'
        }
      >
        <ProviderSelectionHeading
          isSettings={isSettings}
          introduction={screenIntroduction}
          title={screenTitle}
          onBack={navigationRouteKey ? undefined : onBack}
        />
        {chatGPTSetup && presentation === 'settings-accounts' ? (
          <ChatGPTAccountSetupCard setup={chatGPTSetup} />
        ) : null}
        <ModelSelectionTabs
          onCalendarStateChange={publishNavigationState}
          calendarOptions={options}
          chatGPTSetup={chatGPTSetup}
          enabled={presentation === 'settings-provider'}
          languageHeader={
            presentation === 'settings-provider' ? (
              <ProviderSelectionCurrentSummary
                message={selectionMessage}
                draft={confirmationOption?.displayName}
              />
            ) : null
          }
          locked={saving || pendingOption !== null}
          onOpenAccounts={chatGPTSetup?.onOpenAccounts}
        >
          {presentation !== 'settings-accounts' ? (
            <ProviderSelectionChoices
              followsSiblingSummary={presentation === 'settings-provider'}
              chatGPTSetup={chatGPTSetup}
              loading={loading}
              onChoose={option => {
                publishNavigationState(
                  { hasPendingSelection: true, isSavingSelection: false },
                  true,
                );
                search.choose(
                  option,
                  unifiedReview &&
                    option.provider.id === savedSelection?.providerId &&
                    option.modelId === savedSelection.modelId,
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
          {presentation !== 'settings-accounts' ? (
            <ProviderSelectionFooter
              showSummary={presentation !== 'settings-provider'}
              inlineConsent={!unifiedReview}
              searchChoices={unifiedReview ? undefined : search.choices}
              searchReviewStatus={search.status}
              onSearchChoices={search.change}
              message={selectionMessage}
              saveError={saveError}
              remoteAvailable={options.some(
                option =>
                  option.privacyBoundary !== 'on-device' &&
                  option.provider.id !== APPLE_PCC_PROVIDER_ID,
              )}
              resolution={pendingResolution}
              onCancel={() => {
                publishNavigationState(
                  { hasPendingSelection: false, isSavingSelection: false },
                  true,
                );
                search.choose();
                setPendingOption(null);
              }}
              onConfirm={() => {
                if (search.canConfirm()) confirmSelection();
              }}
              option={pendingOption ? confirmationOption : null}
              saving={saving}
            />
          ) : null}
        </ModelSelectionTabs>
      </ScrollView>
      {disclosureSheet}
    </View>
  );
  // Select the same native usable region as the Settings tab before measuring
  // whether this page can borrow the full-width scroll-indicator lane.
  return isSettings ? (
    <AdaptiveColumns primary={screen} testID="settings-provider-columns" />
  ) : (
    screen
  );
}
