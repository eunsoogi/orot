import { useSavedChatGPTTitle } from './useSavedChatGPTTitle';
import { savedModelPresentation } from './savedModelPresentation';
import { useSavedSearchChoices } from './useSavedSearchChoices';
import { useConversationModelConfirmation } from './useConversationModelConfirmation';
import { t } from '../../i18n';
import { APPLE_PCC_PROVIDER_ID } from './privateCloudCompute';
import { ModelSelectionTabs } from './ModelSelectionTabs';
import { useNavigationEdgeVerticalScroll } from '../../navigation/navigationEdgeScroll';
import { useNavigationContentInset } from '../../navigation/useNavigationContentInset';
import { AppButton as Button } from '../../layout/AppButton';
import { AppText as Text } from '../../layout/AppText';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { navigationText } from '../../i18n/navigation';
import ChatGPTAccountSetupCard from './ChatGPTAccountSetupCard';
import { ProviderSelectionChoices } from './ProviderSelectionChoices';
import { ProviderSelectionFooter } from './ProviderSelectionFooter';
import {
  providerSelectionScreenStyles as styles,
  selectionSummaryMessage,
} from './providerSelectionScreenPresentation';
import { resolveProviderSelection } from './providerSelection';
import { providerSelectionText } from './text';
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
  const navigationInset = useNavigationContentInset();
  const [ownerWidth, setOwnerWidth] = useState(0);
  // The embedded feature overlay shares a route key but does not own the route's scroll edge.
  const edge = useNavigationEdgeVerticalScroll({
    ownerWidth:
      navigationRouteKey && presentation !== 'feature' ? ownerWidth : 0,
    trailingPadding: navigationInset.paddingRight ?? styles.container.padding,
  });
  const contentStyle = [styles.container, navigationInset, edge.contentStyle];
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
  return (
    <View
      style={styles.root}
      testID="provider-selection-scroll-lane"
      onLayout={event => setOwnerWidth(event.nativeEvent.layout.width)}
    >
      <ScrollView
        {...edge.indicatorProps}
        contentContainerStyle={contentStyle}
        style={[styles.scrollView, edge.scrollViewStyle]}
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
        <Text accessibilityRole="header" style={styles.title}>
          {presentation === 'feature'
            ? t('modelSettings.languageTitle')
            : (screenTitle ?? providerSelectionText.title)}
        </Text>
        <Text style={styles.introduction}>
          {presentation === 'feature'
            ? t('modelSettings.languagePrompt')
            : (screenIntroduction ?? providerSelectionText.introduction)}
        </Text>
        {chatGPTSetup && presentation === 'settings-accounts' ? (
          <ChatGPTAccountSetupCard setup={chatGPTSetup} />
        ) : null}
        <ModelSelectionTabs
          onCalendarStateChange={publishNavigationState}
          calendarOptions={options}
          chatGPTSetup={chatGPTSetup}
          enabled={presentation === 'settings-provider'}
          locked={saving || pendingOption !== null}
          onOpenAccounts={chatGPTSetup?.onOpenAccounts}
        >
          {presentation !== 'settings-accounts' ? (
            <ProviderSelectionChoices
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
}
