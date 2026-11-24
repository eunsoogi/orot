import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { useSettingsDisclosure } from '../agent/execution/useSettingsDisclosure';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { createRealtimeSettingsPermission } from '../voiceConversation/createRealtimeSettingsPermission';
import { ProviderModelChoiceRow } from '../providers/selection/ProviderModelChoiceRow';
import { ModelSelectionSummary } from '../layout/ModelSelectionSummary';
import { liveModel } from './liveVoicePreferences';
import {
  loadLiveResponsesSettings,
  revokeLiveResponsesSettings,
  saveLiveResponsesSettings,
} from './liveResponsesSettings';
import {
  type LiveResponsesBackend,
  liveResponsesBackends,
  liveResponsesProviderId,
  liveResponsesRecipient,
} from './liveResponsesSettingsIdentity';

/** An explicit, separately disclosed Settings action; choosing GPT-Live or
 * saving its voice options never turns on Responses delegation. */
const backendNames: Readonly<Record<LiveResponsesBackend, string>> = {
  'gpt-6-luna': 'GPT-6 Luna',
  'gpt-6-sol': 'GPT-6 Sol',
};

export function LiveResponsesSettingsPanel({
  active,
  allowedModels,
  onBusyChange,
  ownerRevision,
}: {
  readonly active: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly allowedModels: readonly LiveResponsesBackend[];
  readonly ownerRevision: number;
}) {
  const { consent } = useInferenceConsent();
  const { confirmDisclosure, disclosureSheet } = useSettingsDisclosure();
  const [status, setStatus] = useState<
    'off' | 'active' | 'unavailable' | 'loading'
  >('loading');
  const [saved, setSaved] = useState<LiveResponsesBackend>();
  const [draft, setDraft] = useState<LiveResponsesBackend>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  const operation = useRef<object | null>(null);
  const allowedRef = useRef(allowedModels);
  allowedRef.current = allowedModels;

  useEffect(() => {
    const owner = new AbortController();
    lifetime.current = owner;
    setStatus('loading');
    setDraft(undefined);
    setSaved(undefined);
    setBusy(false);
    setFailed(false);
    let unsubscribe: (() => void) | undefined;
    loadLiveResponsesSettings().then(value => {
      if (owner.signal.aborted) return;
      setStatus(value.kind);
      if (value.kind === 'active') {
        setSaved(value.nativeGrant.backendModel);
        unsubscribe = value.subscribe(() => {
          if (!owner.signal.aborted) setStatus('unavailable');
        });
      }
    });
    return () => {
      owner.abort();
      unsubscribe?.();
      operation.current = null;
    };
  }, [ownerRevision, reload]);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const change = async (enable: boolean) => {
    const owner = lifetime.current;
    const backend = draft;
    if (
      !active ||
      !owner ||
      owner.signal.aborted ||
      operation.current ||
      (enable &&
        (!backend ||
          !allowedRef.current.includes(backend) ||
          backend === saved ||
          (status !== 'off' && status !== 'active')))
    )
      return;
    const token = {};
    operation.current = token;
    const current = () =>
      lifetime.current === owner &&
      !owner.signal.aborted &&
      operation.current === token;
    setBusy(true);
    setFailed(false);
    const audio = createRealtimeSettingsPermission(consent, true);
    try {
      if (enable && backend) {
        if (!(await audio.authorize(liveModel, () => {})) || !current()) {
          if (current()) setFailed(true);
          return;
        }
        const approved = await confirmDisclosure(
          {
            providerId: liveResponsesProviderId,
            modelId: backend,
            recipient: liveResponsesRecipient,
            subtitle: t('modelSettings.liveResponsesConsentTitle'),
            information: t('modelSettings.liveResponsesConsentScope', {
              model: backend,
            }),
            notice: t('modelSettings.liveResponsesConsentNotice'),
          },
          owner.signal,
        );
        const maySave = () => current() && allowedRef.current.includes(backend);
        if (!approved || !maySave() || !audio.current()) return;
        await saveLiveResponsesSettings({
          backendModel: backend,
          signal: owner.signal,
          isCurrent: maySave,
          audioCurrent: audio.current,
        });
      } else {
        // Revocation is not conditional on successful catalog or consent loading.
        await revokeLiveResponsesSettings();
      }
      const value = await loadLiveResponsesSettings();
      if (current()) {
        setStatus(value.kind);
        const settled = enable
          ? value.kind === 'active' &&
            value.nativeGrant.backendModel === backend
          : value.kind === 'off';
        setFailed(!settled);
        if (settled) setReload(n => n + 1);
      }
    } catch {
      if (current()) {
        setStatus('unavailable');
        setFailed(true);
      }
    } finally {
      audio.stop();
      if (current()) {
        operation.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <View style={styles.section} testID="live-responses-setting">
      <Text accessibilityRole="header" style={styles.heading}>
        {t('modelSettings.liveResponsesTitle')}
      </Text>
      <Text style={styles.detail}>
        {t('modelSettings.liveResponsesDescription')}
      </Text>
      {status === 'active' && saved ? (
        <ModelSelectionSummary
          label={t('modelSettings.currentSelection')}
          value={`OpenAI API - ${backendNames[saved]}`}
          testID="live-responses-active-model"
        />
      ) : null}
      {status === 'off' || status === 'active' ? (
        <>
          {liveResponsesBackends.map(model => (
            <ProviderModelChoiceRow
              key={model}
              testID={`live-responses-backend-${model}`}
              title={backendNames[model]}
              detail={model}
              selected={(draft ?? saved) === model}
              disabled={!active || busy || !allowedModels.includes(model)}
              onPress={() => {
                if (
                  active &&
                  !operation.current &&
                  allowedRef.current.includes(model)
                )
                  setDraft(model);
              }}
            />
          ))}
          <AppButton
            title={t('modelSettings.liveResponsesEnable')}
            testID="live-responses-enable"
            disabled={
              !active ||
              busy ||
              !draft ||
              draft === saved ||
              !allowedModels.includes(draft)
            }
            onPress={() => {
              change(true);
            }}
          />
        </>
      ) : null}
      {status === 'loading' ? (
        <Text accessibilityRole="status">
          {t('modelSettings.liveVoicePreferenceLoading')}
        </Text>
      ) : status === 'active' || status === 'unavailable' ? (
        <AppButton
          title={t('modelSettings.liveResponsesDisable')}
          testID="live-responses-disable"
          disabled={busy}
          onPress={() => {
            change(false);
          }}
        />
      ) : null}
      {(status === 'unavailable' || failed) && (
        <Text accessibilityRole="alert">
          {t('modelSettings.liveResponsesUnavailable')}
        </Text>
      )}
      {active ? disclosureSheet : null}
    </View>
  );
}
