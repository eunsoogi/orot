import { useEffect, useRef, useState } from 'react';
import { voiceSettingsStore } from './voiceSettingsStore';
import { voiceModels } from './voiceModels';

const errors: Record<string, string> = {
  access: 'API 인증 또는 모델 접근 권한을 확인해 주세요.',
  'rate-limit': '요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
  network: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
  'account-changed': '연결 계정이 변경되었습니다. 목록을 다시 불러와 주세요.',
};
/** Catalogs are memory-only and scoped to a credential revision. Opening settings
 * never contacts the provider. A failed refresh retains an explicitly stale list.
 */
export function useVoiceCatalog() {
  const [connected, setConnected] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('연결 계정을 확인하고 있습니다.');
  const [fresh, setFresh] = useState(false);
  const revision = useRef<number | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    let alive = true;
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
              ? '이 API 계정의 모델 목록을 새로고침해 주세요.'
              : '연결된 계정에서 OpenAI API 키를 등록해 주세요.',
          );
        }
      } catch {
        if (!alive || request !== generation.current) return;
        setConnected(false);
        setIds([]);
        setFresh(false);
        setMessage('계정을 읽지 못했습니다. 화면을 다시 열어 주세요.');
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
  }, []);
  const refresh = async () => {
    if (busy || !connected) return;
    const request = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setFresh(false);
    setMessage('이 API 계정의 모델을 불러오고 있습니다.');
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
          ? '현재 API 계정에서 조회한 목록입니다. 통화 권한과 잔액, 실제 세션 사용 가능 여부는 별도로 확인됩니다.'
          : '이 계정에서 조회된 모델 중 이 앱이 지원하는 Realtime 음성 모델이 없습니다. 알 수 없는 기능은 추정하지 않습니다.',
      );
    } catch (error) {
      if (request !== generation.current) return;
      setMessage(
        errors[error instanceof Error ? error.message : ''] ??
          '모델 목록을 불러오지 못했습니다. 다시 시도해 주세요.',
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
