import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { localVoiceModel } from './voiceModels';
import { voiceSettingsStore, type VoiceMode } from './voiceSettingsStore';
import type { useVoiceCatalog } from './useVoiceCatalog';

/** Owns a draft independently from saved choice; saving never starts audio or grants consent. */
export function useVoiceSelection(catalog: ReturnType<typeof useVoiceCatalog>) {
  const [mode, setMode] = useState<VoiceMode>('local');
  const [model, setModel] = useState<string>(localVoiceModel);
  const [savedModel, setSavedModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [failedLoad, setFailedLoad] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    voiceSettingsStore
      .load()
      .then(value => {
        if (!mounted.current) return;
        setMode(value.mode);
        setModel(value.model);
        setSavedModel(value.model);
      })
      .catch(() => {
        if (mounted.current) {
          setFailedLoad(true);
          setMessage(t('modelSettings.voiceReadFailed'));
        }
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async () => {
    if (locked.current || failedLoad) return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    try {
      await voiceSettingsStore.save({
        mode,
        model,
        ...(mode === 'openai-api' && catalog.revision !== null
          ? { expectedAccountRevision: catalog.revision }
          : {}),
      });
      if (!mounted.current) return;
      setSavedModel(model);
      setMessage(t('modelSettings.voiceSaved'));
    } catch {
      if (mounted.current) setMessage(t('modelSettings.voiceSaveFailed'));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
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
