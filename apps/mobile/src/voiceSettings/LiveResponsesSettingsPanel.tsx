import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { useSettingsDisclosure } from '../agent/execution/useSettingsDisclosure';
import { t } from '../i18n';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { createRealtimeSettingsPermission } from '../voiceConversation/createRealtimeSettingsPermission';
import { LiveVoiceCatalogSelect } from './LiveVoiceCatalogSelect';
import { liveModel } from './liveVoicePreferences';
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
export function LiveResponsesSettingsPanel({
  allowedModels,
  ownerRevision,
}: {
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
  const [expanded, setExpanded] = useState(false);
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
    setExpanded(false);
    setBusy(false);
    setFailed(false);
    let unsubscribe: (() => void) | undefined;
    void loadLiveResponsesSettings().then(value => {
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

  const change = async (enable: boolean) => {
    const owner = lifetime.current;
    const backend = draft;
    if (
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
        <Text style={styles.detail} testID="live-responses-active-model">
          {t('modelSettings.currentSelection')} {saved}
        </Text>
      ) : null}
      {status === 'off' || status === 'active' ? (
        <>
          <LiveVoiceCatalogSelect<LiveResponsesBackend>
            testID="live-responses-backend"
            label={t('modelSettings.liveResponsesTitle')}
            options={allowedModels.map(id => [id, id] as const)}
            value={draft ?? saved}
            expanded={expanded}
            busy={busy || allowedModels.length === 0}
            onSelect={value => {
              if (!operation.current && allowedRef.current.includes(value)) {
                setDraft(value);
                setExpanded(false);
              }
            }}
            onToggle={() => setExpanded(value => !value)}
          />
          <AppButton
            title={t('modelSettings.liveResponsesEnable')}
            testID="live-responses-enable"
            disabled={
              busy ||
              !draft ||
              draft === saved ||
              !allowedModels.includes(draft)
            }
            onPress={() => void change(true)}
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
          onPress={() => void change(false)}
        />
      ) : null}
      {(status === 'unavailable' || failed) && (
        <Text accessibilityRole="alert">
          {t('modelSettings.liveResponsesUnavailable')}
        </Text>
      )}
      {disclosureSheet}
    </View>
  );
}
