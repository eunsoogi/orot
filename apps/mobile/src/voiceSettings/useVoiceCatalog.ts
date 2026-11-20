import { t } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { useModelSettingsServices } from '../agent/execution/ModelSettingsServices';
import { voiceModels } from './voiceModels';

const errors: Record<string, string> = {
  access: t('modelSettings.accessError'),
  'rate-limit': t('modelSettings.rateLimitError'),
  network: t('modelSettings.networkError'),
  'account-changed': t('modelSettings.accountChanged'),
};
/** Catalogs are memory-only and scoped to a credential revision. Opening settings
 * never contacts the provider. A failed refresh retains an explicitly stale list.
 */
export function useVoiceCatalog() {
  const { voice: voiceSettingsStore } = useModelSettingsServices();
  const [connected, setConnected] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(t('modelSettings.checkingAccount'));
  const [fresh, setFresh] = useState(false);
  const revision = useRef<number | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
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
    if (busy || !connected) return;
    const request = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setFresh(false);
    setMessage(t('modelSettings.loadingModels'));
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const result = await voiceSettingsStore.discoverModels(abort.signal);
      if (request !== generation.current) return;
      if (result.revision !== revision.current)
        throw new Error('account-changed');
      const supported = result.ids.filter(id =>
        voiceModels.some(
          model => model.mode === 'openai-api' && model.id === id,
        ),
      );
      setIds(supported);
      setFresh(true);
      setMessage(
        supported.length
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
  return {
    connected,
    ids,
    busy,
    fresh,
    message,
    refresh,
    revision: revision.current,
  };
}
