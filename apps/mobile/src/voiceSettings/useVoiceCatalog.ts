import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { useModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import { voiceModels } from './voiceModels';
import { voiceSettingsStore as productionVoiceStore } from './voiceSettingsStore';
import { supportedVoiceModelIds } from './voiceCatalogDisplayStore';
import { isLiveResponsesBackend } from './liveResponsesSettingsIdentity';

const isSpeechModel = (id: string) =>
  voiceModels.some(model => model.mode === 'openai-api' && model.id === id);

const errors: Record<string, string> = {
  access: t('modelSettings.accessError'),
  'rate-limit': t('modelSettings.rateLimitError'),
  network: t('modelSettings.networkError'),
  'account-changed': t('modelSettings.accountChanged'),
};
/** Opening Settings reads only the current account's durable display hints.
 * Only a successful explicit refresh authorizes fresh selection/save. */
export function useVoiceCatalog() {
  const { voice: voiceSettingsStore } = useModelSettingsServices();
  const [connected, setConnected] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(t('modelSettings.checkingAccount'));
  const [fresh, setFresh] = useState(false);
  const owner = useRef(voiceSettingsStore);
  const revision = useRef<number | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
    owner.current = voiceSettingsStore;
    // Equal numeric revisions from a different service owner are not the same account.
    revision.current = null;
    setConnected(false);
    setFresh(false);
    setIds([]);
    const load = async () => {
      const request = ++generation.current;
      controller.current?.abort();
      setBusy(false);
      try {
        const status = await voiceSettingsStore.accountStatus();
        if (!alive || request !== generation.current) return;
        setConnected(status.connected);
        if (revision.current !== status.revision || !status.connected) {
          revision.current = status.revision;
          setIds([]);
          setFresh(false);
          setMessage(
            status.connected
              ? t('modelSettings.refreshAccountModels')
              : t('modelSettings.registerApiKey'),
          );
          if (
            status.connected &&
            voiceSettingsStore === productionVoiceStore &&
            typeof productionVoiceStore.loadDisplayModelCatalog === 'function'
          ) {
            const saved = await productionVoiceStore
              .loadDisplayModelCatalog(status.revision)
              .catch(() => []);
            if (
              alive &&
              request === generation.current &&
              revision.current === status.revision &&
              voiceSettingsStore.accountRevisionMatches?.(status.revision) ===
                true
            )
              setIds(supportedVoiceModelIds(saved));
          }
        }
      } catch {
        if (!alive || request !== generation.current) return;
        setConnected(false);
        setIds([]);
        setFresh(false);
        setMessage(t('modelSettings.accountReadFailed'));
      }
    };
    load();
    const unsubscribe = voiceSettingsStore.subscribe(() => {
      if (
        revision.current !== null &&
        voiceSettingsStore.accountRevisionMatches?.(revision.current) !== true
      ) {
        // Retire the old owner's choices before the next keychain read settles.
        revision.current = null;
        setConnected(false);
        setIds([]);
        setFresh(false);
        setMessage(t('modelSettings.checkingAccount'));
      }
      load();
    });
    // These refs are request state, not a mounted DOM/native node. Invalidate all
    // outstanding callbacks on unmount, even if a transport ignores cancellation.
    const invalidate = () => {
      generation.current += 1;
      controller.current?.abort();
    };
    return () => {
      alive = false;
      invalidate();
      unsubscribe();
    };
  }, [voiceSettingsStore]);
  const refresh = async () => {
    if (
      owner.current !== voiceSettingsStore ||
      busy ||
      !connected ||
      revision.current === null
    )
      return;
    const request = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setFresh(false);
    setMessage(t('modelSettings.loadingModels'));
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const result = await (voiceSettingsStore === productionVoiceStore &&
      typeof productionVoiceStore.refreshDisplayModels === 'function'
        ? productionVoiceStore.refreshDisplayModels(abort.signal)
        : voiceSettingsStore.discoverModels(abort.signal));
      if (request !== generation.current) return;
      if (result.revision !== revision.current)
        throw new Error('account-changed');
      // Keep both approved subsets from the same explicit account refresh.
      const supported = supportedVoiceModelIds(result.ids);
      setIds(supported);
      setFresh(true);
      setMessage(
        supported.some(isSpeechModel)
          ? t('modelSettings.modelListNotice')
          : t('modelSettings.noSupportedVoice'),
      );
    } catch (error) {
      if (request !== generation.current) return;
      setMessage(
        errors[error instanceof Error ? error.message : ''] ??
          t('modelSettings.modelLoadFailed'),
      );
    } finally {
      clearTimeout(timeout);
      if (request === generation.current) setBusy(false);
    }
  };
  const currentOwner = owner.current === voiceSettingsStore;
  return {
    connected: currentOwner && connected,
    ids: currentOwner ? ids.filter(isSpeechModel) : [],
    toolIds: currentOwner ? ids.filter(isLiveResponsesBackend) : [],
    busy,
    fresh: currentOwner && fresh,
    message,
    refresh,
    revision: currentOwner ? revision.current : null,
  };
}
