import { useVoiceConsentSave } from './useVoiceConsentSave';
import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { localVoiceModel } from './voiceModels';
import {
  voiceSettingsStore as ownedVoiceSettingsStore,
  type VoiceMode,
} from './voiceSettingsStore';
import { useModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import type { useVoiceCatalog } from './useVoiceCatalog';

/** Owns a draft independently from saved choice; saving never starts audio; explicit external selection includes settings consent. */
export function useVoiceSelection(catalog: ReturnType<typeof useVoiceCatalog>) {
  const { voice: voiceSettingsStore } = useModelSettingsServices();
  const saveConsent = useVoiceConsentSave(catalog.revision);
  const [mode, setMode] = useState<VoiceMode>('local');
  const [model, setModel] = useState<string>(localVoiceModel);
  const [saved, setSaved] = useState<{ mode: VoiceMode; model: string } | null>(
    null,
  );
  const [pairAwaitingActivation, setPairAwaitingActivation] = useState(false);
  const [busy, setBusy] = useState(true);
  const [failedLoad, setFailedLoad] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const locked = useRef(false);
  const owner = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const version = ++owner.current;
    setBusy(true);
    setFailedLoad(false);
    setSaved(null);
    setPairAwaitingActivation(false);
    const presentation =
      voiceSettingsStore === ownedVoiceSettingsStore &&
      typeof ownedVoiceSettingsStore.loadVoicePairPresentation === 'function'
        ? ownedVoiceSettingsStore.loadVoicePairPresentation()
        : voiceSettingsStore
            .load()
            .then(settings => ({ settings, pairPresentationCurrent: null }));
    presentation
      .then(({ settings: value, pairPresentationCurrent }) => {
        if (!mounted.current || version !== owner.current) return;
        setPairAwaitingActivation(
          value.pairAwaitingActivation === true ||
            pairPresentationCurrent?.() === false,
        );
        setMode(value.mode);
        setModel(value.model);
        setSaved({ mode: value.mode, model: value.model });
      })
      .catch(() => {
        if (mounted.current && version === owner.current) {
          setFailedLoad(true);
          setMessage(t('modelSettings.voiceReadFailed'));
        }
      })
      .finally(() => {
        if (mounted.current && version === owner.current) setBusy(false);
      });
    return () => {
      mounted.current = false;
      owner.current += 1;
    };
  }, [voiceSettingsStore]);
  const save = async (isCurrentDraft: () => boolean = () => true) => {
    if (locked.current || failedLoad) return false;
    locked.current = true;
    const version = owner.current;
    const current = () =>
      mounted.current && version === owner.current && isCurrentDraft();
    setBusy(true);
    setMessage('');
    try {
      await saveConsent(mode, model, current);
      if (!current()) return false;
      setPairAwaitingActivation(false);
      setSaved({ mode, model });
      setMessage(t('modelSettings.voiceSaved'));
      return true;
    } catch {
      if (current()) setMessage(t('modelSettings.voiceSaveFailed'));
      return false;
    } finally {
      locked.current = false;
      if (mounted.current && version === owner.current) setBusy(false);
    }
  };
  return {
    mode,
    model,
    savedModel: saved?.model ?? null,
    savedMode: saved?.mode,
    busy,
    failedLoad,
    pairAwaitingActivation,
    message,
    save,
    markPairUnavailable() {
      setPairAwaitingActivation(true);
      setMessage('');
    },
    markPairSaved(nextModel: string) {
      setPairAwaitingActivation(false);
      setSaved({ mode: 'openai-api', model: nextModel });
      setMessage(t('modelSettings.voiceSaved'));
    },
    choose: (nextMode: VoiceMode, nextModel: string) => {
      setMode(nextMode);
      setModel(nextModel);
      setMessage('');
    },
  };
}
