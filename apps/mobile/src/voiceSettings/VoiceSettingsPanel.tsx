import { ModelSettingsConsentDisclosure } from '../agent/execution/ModelSettingsConsentDisclosure';
import ProviderSelectionOptionCard from '../providers/selection/ProviderSelectionOptionCard';
import { applePrivateCloudComputeProvider } from '../providers/apple';
import { APPLE_PCC_MODEL_ID } from '../providers/selection/privateCloudCompute';
import { t } from '../i18n';
import { ModelSelectionSummary } from '../layout/ModelSelectionSummary';
import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import { useVoiceCatalog } from './useVoiceCatalog';
import { useVoiceSelection } from './useVoiceSelection';
import { hasRealtimeVoiceRuntime } from './voiceRuntimeCapability';
import { voiceModels } from './voiceModels';
import { VoiceModelOption } from './VoiceModelOption';
import { VoiceCatalogAccount } from './VoiceCatalogAccount';

/** Local and API providers are sibling sections; a hidden tab must not own navigation actions. */
export function VoiceSettingsPanel({
  onOpenAccounts,
  active = true,
}: {
  readonly onOpenAccounts?: () => void;
  readonly active?: boolean;
}) {
  const catalog = useVoiceCatalog();
  const selection = useVoiceSelection(catalog);
  const realtimeAvailable = hasRealtimeVoiceRuntime();
  const { mode, model, savedModel, busy, failedLoad, message } = selection;
  const disabled =
    busy ||
    failedLoad ||
    (mode === 'openai-api' && (!catalog.fresh || !catalog.ids.includes(model)));
  const hasDock = useNavigationRouteActions(
    [
      {
        id: 'confirm-voice-model',
        label: t('modelSettings.confirmVoice'),
        accessibilityLabel: t('modelSettings.confirmVoice'),
        testID: 'voice-settings-save',
        systemImageName: 'checkmark',
        disabled,
        busy,
        onPress: selection.save,
      },
    ],
    active,
  );
  const choices = (connection: 'local' | 'openai-api') =>
    voiceModels
      .filter(
        item =>
          item.mode === connection &&
          (item.mode === 'local' || catalog.ids.includes(item.id)),
      )
      .map(item => (
        <VoiceModelOption
          key={item.id}
          item={item}
          selected={model === item.id}
          disabled={
            busy || failedLoad || (item.mode === 'openai-api' && !catalog.fresh)
          }
          onPress={() => selection.choose(item.mode, item.id)}
        />
      ));
  return (
    <View testID="voice-settings-panel">
      {mode === 'openai-api' ? (
        <ModelSettingsConsentDisclosure
          slot="voice"
          recipient="OpenAI Realtime API"
        />
      ) : null}
      <View style={styles.section} testID="voice-model-group-local">
        <Text accessibilityRole="header" style={styles.heading}>
          Apple
        </Text>
        {choices('local')}
        {/* Display-only: PCC has no voice runtime and must never enter voiceModels or save. */}
        <ProviderSelectionOptionCard
          option={{
            provider: applePrivateCloudComputeProvider,
            modelId: APPLE_PCC_MODEL_ID,
            displayName: 'Apple Intelligence',
            privacyBoundary: 'selected-context-remote',
            availability: {
              status: 'unavailable',
              message: t('provider.pcc.entitlementRequired'),
            },
          }}
          requirements={{ inputTypes: ['text'] }}
          disabled
          selected={false}
          index={0}
          onPress={() => undefined}
        />
      </View>
      <View style={styles.section} testID="voice-model-group-openai-api">
        <Text accessibilityRole="header" style={styles.heading}>
          OpenAI API
        </Text>
        <View style={styles.catalogAccount}>
          <VoiceCatalogAccount
            catalog={catalog}
            onOpenAccounts={onOpenAccounts}
          />
          {choices('openai-api')}
        </View>
        {catalog.message &&
        catalog.message !== t('modelSettings.refreshAccountModels') ? (
          <Text accessibilityRole="status" style={styles.secondary}>
            {catalog.message}
          </Text>
        ) : null}
        {!catalog.fresh && catalog.ids.length > 0 ? (
          <Text style={styles.detail}>{t('modelSettings.staleModels')}</Text>
        ) : null}
      </View>
      <View style={styles.section}>
        {!busy && !failedLoad ? (
          <ModelSelectionSummary
            label={t('modelSettings.currentSelection')}
            value={
              voiceModels.find(item => item.id === savedModel)?.title ??
              savedModel ??
              ''
            }
            testID="voice-current-model"
          />
        ) : null}
        {mode === 'openai-api' && !realtimeAvailable ? (
          <Text accessibilityRole="alert">
            {t('modelSettings.voiceUnavailable')}
          </Text>
        ) : null}
        {!hasDock && active ? (
          <Button
            title={t('modelSettings.confirmVoice')}
            testID="voice-settings-save"
            disabled={disabled}
            onPress={selection.save}
          />
        ) : null}
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
      </View>
    </View>
  );
}
