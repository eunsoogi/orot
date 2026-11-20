import { useVoiceConsentSave } from './useVoiceConsentSave';
import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { localVoiceModel } from './voiceModels';
import type { VoiceMode } from './voiceSettingsStore';
import { useModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import type { useVoiceCatalog } from './useVoiceCatalog';

/** Owns a draft independently from saved choice; saving never starts audio; explicit external selection includes settings consent. */
export function useVoiceSelection(catalog: ReturnType<typeof useVoiceCatalog>) {
  const { voice: voiceSettingsStore } = useModelSettingsServices();
  const saveConsent = useVoiceConsentSave(catalog.revision);
  const [mode, setMode] = useState<VoiceMode>('local');
  const [model, setModel] = useState<string>(localVoiceModel);
  const [savedModel, setSavedModel] = useState<string | null>(null);
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
    setSavedModel(null);
    voiceSettingsStore
      .load()
      .then(value => {
        if (!mounted.current || version !== owner.current) return;
        setMode(value.mode);
        setModel(value.model);
        setSavedModel(value.model);
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
  const save = async () => {
    if (locked.current || failedLoad) return;
    locked.current = true;
    const version = owner.current;
    setBusy(true);
    setMessage('');
    try {
      await saveConsent(mode, model);
      if (!mounted.current || version !== owner.current) return;
      setSavedModel(model);
      setMessage(t('modelSettings.voiceSaved'));
    } catch {
      if (mounted.current && version === owner.current)
        setMessage(t('modelSettings.voiceSaveFailed'));
    } finally {
      locked.current = false;
      if (mounted.current && version === owner.current) setBusy(false);
    }
  };
  return {
    mode,
    model,
    savedModel,
    busy,
    failedLoad,
    message,
    save,
    choose: (nextMode: VoiceMode, nextModel: string) => {
      setMode(nextMode);
      setModel(nextModel);
      setMessage('');
    },
  };
}
