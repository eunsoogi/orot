import { useSettingsDisclosure } from '../agent/execution/useSettingsDisclosure';
import { useEffect, useRef, useState } from 'react';
import {
  liveVoiceProviderId,
  liveVoiceRecipient,
} from '../agent/execution/liveVoiceSettingsIdentity';
import { t } from '../i18n';
import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { createRealtimeSettingsPermission } from '../voiceConversation/createRealtimeSettingsPermission';
import type { LiveVoicePreferencesDraft } from './LiveVoicePreferencesPanel';
import type { LiveVoicePreferenceStore } from './liveVoicePreferenceStore';
import type { VoiceMode } from './voiceSettingsStore';

/** Keep preference-only saves outside model and consent mutation. */
export function useLiveVoiceSettingsSave({
  active,
  disabled,
  canApproveNew,
  mode,
  model,
  savedModel,
  revision,
  save,
  store,
}: {
  active: boolean;
  disabled: boolean;
  canApproveNew: boolean;
  mode: VoiceMode;
  model: string;
  savedModel: string | null;
  revision: number | null;
  save: (isCurrentDraft?: () => boolean) => Promise<boolean>;
  store: LiveVoicePreferenceStore;
}) {
  const { consent } = useInferenceConsent();
  const [prefs, setPrefs] = useState<LiveVoicePreferencesDraft | null>(null);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsFailed, setPrefsFailed] = useState(false);
  const [saveRevision, setSaveRevision] = useState(0);
  const { confirmDisclosure, disclosureSheet, cancelDisclosure } =
    useSettingsDisclosure();
  const pending = useRef<object | null>(null);
  const authority = useRef({
    active,
    disabled,
    canApproveNew,
    mode,
    model,
    revision,
    store,
  });
  authority.current = {
    active,
    disabled,
    canApproveNew,
    mode,
    model,
    revision,
    store,
  };
  useEffect(() => {
    setPrefsBusy(false);
    return () => {
      cancelDisclosure();
      pending.current = null;
    };
  }, [active, mode, model, revision, store, cancelDisclosure]);
  const confirmSave = async () => {
    const before = authority.current;
    if (!before.active || before.disabled || pending.current) return;
    const token = {};
    const current = () =>
      pending.current === token &&
      authority.current.active &&
      authority.current.mode === before.mode &&
      authority.current.model === before.model &&
      authority.current.revision === before.revision &&
      authority.current.store === before.store;
    const finish = () => {
      if (pending.current === token) {
        pending.current = null;
        setPrefsBusy(false);
      }
    };
    if (before.mode === 'local') {
      pending.current = token;
      try {
        await save(current);
      } finally {
        finish();
      }
      return;
    }
    const grant = createRealtimeSettingsPermission(consent, true);
    const persist = async () => {
      if (!current() || !prefs?.dirty) return;
      await store.save(prefs.owner, prefs.preferences);
      if (current()) setSaveRevision(value => value + 1);
    };
    const run = async (saveModel: boolean) => {
      if (!current()) {
        grant.stop();
        return;
      }
      setPrefsBusy(true);
      try {
        if (saveModel ? await save(current) : grant.current()) await persist();
      } catch {
        if (current()) setPrefsFailed(true);
      } finally {
        grant.stop();
        finish();
      }
    };
    pending.current = token;
    setPrefsBusy(true);
    setPrefsFailed(false);
    if (savedModel === model && (await grant.authorize(model, () => {}))) {
      await run(false);
      return;
    }
    if (!current()) {
      grant.stop();
      return;
    }
    if (!authority.current.canApproveNew) {
      grant.stop();
      setPrefsFailed(true);
      finish();
      return;
    }
    setPrefsBusy(false);
    const disclosure = new AbortController();
    const approved = await confirmDisclosure(
      {
        providerId: liveVoiceProviderId,
        modelId: model,
        recipient: liveVoiceRecipient,
        subtitle: t('modelSettings.liveVoiceConsentTitle'),
        information: t('modelSettings.liveVoiceConsentScope'),
        notice: t('modelSettings.liveVoiceConsentNotice'),
      },
      disclosure.signal,
    );
    disclosure.abort();
    if (!current()) {
      grant.stop();
      return;
    }
    if (
      approved &&
      !authority.current.disabled &&
      authority.current.canApproveNew
    )
      await run(true);
    else finish();
  };
  return {
    confirmSave,
    setPrefs,
    prefsBusy,
    prefsFailed,
    saveRevision,
    disclosureSheet,
  };
}
