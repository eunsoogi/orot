import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { NativeModules, Platform, Pressable, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { useSettingsDisclosure } from '../agent/execution/useSettingsDisclosure';
import { t } from '../i18n';
import {
  readCanonicalLiveHealthChoice,
  revokeCanonicalLiveHealthSettings,
  saveCanonicalLiveHealthSettings,
} from './liveCanonicalHealthSettings';
import type { LiveResponsesBackend } from './liveResponsesSettingsIdentity';

type Owner = Readonly<{ revision: number; backend: LiveResponsesBackend }>;
const runtime = () =>
  Platform.OS === 'ios' &&
  NativeModules.VoiceRealtimeModule?.supportsCanonicalHealthContextV2 === true;

/** Owned companion selection only. Checking, drafting or cancelling never sends data. */
export function useCanonicalLiveHealthSelection(
  owner: Owner | undefined,
  otherDraftDirty: boolean,
) {
  const backend = owner?.backend;
  const revision = owner?.revision;
  const { confirmDisclosure, cancelDisclosure, disclosureSheet } =
    useSettingsDisclosure();
  const [loaded, setLoaded] = useState<
    | {
        backend: LiveResponsesBackend;
        revision: number;
        enabled: boolean;
        current: () => boolean;
        ownerCurrent: () => boolean;
      }
    | undefined
  >();
  const [choice, setChoice] = useState<boolean>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const currentAttempt = useRef<AbortController | null>(null);
  const lease = useRef<object | undefined>(undefined);
  const unrelated = useRef(otherDraftDirty);
  useLayoutEffect(() => {
    unrelated.current = otherDraftDirty;
    if (otherDraftDirty && currentAttempt.current) {
      currentAttempt.current.abort();
      currentAttempt.current = null;
      setBusy(false);
    }
  }, [otherDraftDirty]);
  const supported = runtime();
  useLayoutEffect(() => {
    const token = {};
    lease.current = token;
    setLoaded(undefined);
    setChoice(undefined);
    setBusy(false);
    setError(false);
    return () => {
      lease.current = undefined;
      currentAttempt.current?.abort();
      currentAttempt.current = null;
      cancelDisclosure();
    };
  }, [backend, revision, supported, attempt, cancelDisclosure]);

  useEffect(() => {
    if (!supported || !backend || revision === undefined) return;
    const token = lease.current;
    let pending = true;
    const report = (
      receipt: Awaited<ReturnType<typeof readCanonicalLiveHealthChoice>>,
    ) => {
      if (!pending || token !== lease.current) return;
      if (receipt?.current()) setLoaded({ ...receipt, backend, revision });
    };
    readCanonicalLiveHealthChoice(backend).then(report, () =>
      report(undefined),
    );
    return () => {
      pending = false;
    };
  }, [backend, revision, supported, attempt]);

  const stable =
    supported &&
    loaded?.backend === backend &&
    loaded?.revision === revision &&
    loaded?.current()
      ? loaded
      : undefined;
  const dirty = Boolean(
    stable && choice !== undefined && choice !== stable.enabled,
  );
  const save = useCallback(async () => {
    if (
      !stable ||
      !dirty ||
      otherDraftDirty ||
      currentAttempt.current ||
      choice === undefined
    )
      return;
    const controller = new AbortController();
    const token = lease.current;
    const current = () =>
      token === lease.current &&
      !controller.signal.aborted &&
      !unrelated.current &&
      stable.ownerCurrent();
    currentAttempt.current = controller;
    setBusy(true);
    setError(false);
    let saved = false;
    try {
      if (choice) {
        saved = await saveCanonicalLiveHealthSettings({
          signal: controller.signal,
          current,
          confirm: (review, signal) =>
            confirmDisclosure(
              {
                providerId: review.providerId,
                modelId: review.model,
                recipient: review.recipient,
                subtitle: t('modelSettings.canonicalLiveHealthConsentTitle'),
                information: t('modelSettings.canonicalLiveHealthConsentScope'),
                notice: t('modelSettings.canonicalLiveHealthConsentNotice'),
              },
              signal,
            ),
        });
      } else if (current()) {
        await revokeCanonicalLiveHealthSettings();
        saved = true;
      }
    } catch {
      if (token === lease.current && !controller.signal.aborted) setError(true);
    } finally {
      if (currentAttempt.current === controller) currentAttempt.current = null;
      if (token === lease.current && !controller.signal.aborted) {
        setBusy(false);
        if (saved) setAttempt(value => value + 1);
      }
    }
  }, [stable, dirty, otherDraftDirty, choice, confirmDisclosure]);

  return {
    busy,
    dirty,
    save,
    disclosureSheet,
    option: stable ? (
      <View>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={t('modelSettings.canonicalLiveHealth')}
          accessibilityState={{
            checked: choice ?? stable.enabled,
            disabled: busy || otherDraftDirty,
          }}
          disabled={busy || otherDraftDirty}
          style={styles.section}
          testID="voice-canonical-health-choice"
          onPress={() => setChoice(previous => !(previous ?? stable.enabled))}
        >
          <Text>{t('modelSettings.canonicalLiveHealth')}</Text>
          <Text>
            {t(
              (choice ?? stable.enabled)
                ? 'modelSettings.canonicalLiveHealthOn'
                : 'modelSettings.canonicalLiveHealthOff',
            )}
          </Text>
        </Pressable>
        {error ? (
          <Text accessibilityRole="alert">
            {t('modelSettings.canonicalLiveHealthSaveError')}
          </Text>
        ) : null}
      </View>
    ) : null,
  };
}
