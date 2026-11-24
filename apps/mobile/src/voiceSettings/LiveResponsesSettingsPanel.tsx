import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';
import { View } from 'react-native';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { useSettingsDisclosure } from '../agent/execution/useSettingsDisclosure';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { modelSettingsPageGap } from '../layout/providerSettingsPresentation';
import { createRealtimeSettingsPermission } from '../voiceConversation/createRealtimeSettingsPermission';
import { ProviderModelChoiceRow } from '../providers/selection/ProviderModelChoiceRow';
import { ModelSelectionSummary } from '../layout/ModelSelectionSummary';
import { liveModel } from './liveVoicePreferences';
import { voiceSettingsStore } from './voiceSettingsStore';
import {
  loadLiveResponsesSettings,
  revokeLiveResponsesSettings,
  saveLiveResponsesSettings,
} from './liveResponsesSettings';
import {
  type LiveResponsesBackend,
  liveResponsesProviderId,
  liveResponsesRecipient,
} from './liveResponsesSettingsIdentity';

/** An explicit, separately disclosed Settings action; choosing GPT-Live or
 * saving its voice options never turns on Responses delegation. */
const modelRows = { gap: modelSettingsPageGap };
const backendNames: Readonly<Record<LiveResponsesBackend, string>> = {
  'gpt-6-luna': 'GPT-6 Luna',
  'gpt-6-sol': 'GPT-6 Sol',
};

export function LiveResponsesSettingsPanel({
  active,
  allowedModels,
  onBusyChange,
  onSaveStateChange,
  saveRef,
  ownerRevision,
}: {
  readonly active: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onSaveStateChange: (canSave: boolean) => void;
  readonly saveRef: Ref<() => void>;
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
  const availability = useRef({ active, allowedModels });
  availability.current = { active, allowedModels };
  const selectable = (model: LiveResponsesBackend) =>
    availability.current.active &&
    availability.current.allowedModels.includes(model);

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
      !voiceSettingsStore.accountRevisionMatches(ownerRevision) ||
      !owner ||
      owner.signal.aborted ||
      operation.current ||
      (enable &&
        (!backend ||
          !selectable(backend) ||
          backend === saved ||
          (status !== 'off' && status !== 'active')))
    )
      return;
    const token = {};
    operation.current = token;
    const current = () =>
      voiceSettingsStore.accountRevisionMatches(ownerRevision) &&
      lifetime.current === owner &&
      !owner.signal.aborted &&
      operation.current === token;
    setBusy(true);
    setFailed(false);
    const audio = createRealtimeSettingsPermission(consent, true);
    try {
      if (enable && backend) {
        if (
          !(await audio.authorize(liveModel, () => {})) ||
          !current() ||
          !availability.current.active
        ) {
          if (current() && availability.current.active) setFailed(true);
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
        const maySave = () => current() && selectable(backend);
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

  const canSave =
    active &&
    !busy &&
    !!draft &&
    draft !== saved &&
    (status === 'off' || status === 'active') &&
    allowedModels.includes(draft);
  useLayoutEffect(() => {
    onSaveStateChange(canSave);
    return () => onSaveStateChange(false);
  }, [canSave, onSaveStateChange]);
  // The shared action still rechecks ownership and disclosure in change.
  useImperativeHandle(saveRef, () => () => change(true));

  return (
    <View style={modelRows} testID="live-responses-setting">
      {status === 'active' && saved ? (
        <ModelSelectionSummary
          label={t('modelSettings.currentSelection')}
          value={`OpenAI API - ${backendNames[saved]}`}
          testID="live-responses-active-model"
        />
      ) : null}
      {status === 'off' || status === 'active'
        ? allowedModels.map(model => (
            <ProviderModelChoiceRow
              key={model}
              testID={`live-responses-backend-${model}`}
              title={backendNames[model]}
              detail={model}
              selected={(draft ?? saved) === model}
              disabled={!active || busy}
              onPress={() => {
                if (!operation.current && selectable(model)) setDraft(model);
              }}
            />
          ))
        : null}
      {status === 'loading' && (
        <Text accessibilityRole="status">
          {t('modelSettings.liveVoicePreferenceLoading')}
        </Text>
      )}
      {(status === 'active' || status === 'unavailable') && (
        <AppButton
          title={t('modelSettings.liveResponsesDisable')}
          testID="live-responses-disable"
          disabled={busy}
          onPress={() => {
            change(false);
          }}
        />
      )}
      {(status === 'unavailable' || failed) && (
        <Text accessibilityRole="alert">
          {t('modelSettings.liveResponsesUnavailable')}
        </Text>
      )}
      {active ? disclosureSheet : null}
    </View>
  );
}
