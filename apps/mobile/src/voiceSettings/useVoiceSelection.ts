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
          setMessage('음성 설정을 읽지 못했습니다. 화면을 다시 열어 주세요.');
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
      setMessage(
        '음성 설정을 저장했습니다. 통화는 대화 화면에서 별도로 시작해 주세요.',
      );
    } catch {
      if (mounted.current)
        setMessage(
          '저장하지 못했습니다. API 모드에는 모델과 API 키가 필요합니다.',
        );
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
