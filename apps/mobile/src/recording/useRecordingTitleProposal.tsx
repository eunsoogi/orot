import { useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { generateRecordingTitle } from './recordingTitleGeneration';

type Proposal = NonNullable<Awaited<ReturnType<typeof generateRecordingTitle>>>;

export function useRecordingTitleProposal(
  sourceId: string,
  owner: NavigationRouteOwnership | undefined,
  saved?: (title: string) => void,
) {
  const attempt = useRef<{ abort: AbortController } | undefined>(undefined);
  const callback = useRef(saved);
  callback.current = saved;
  const [proposal, setProposal] = useState<Proposal>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useLayoutEffect(() => {
    const retire = () => {
      attempt.current?.abort.abort();
    };
    setProposal(undefined);
    setBusy(false);
    setError(false);
    const unsub = owner?.subscribe(() => {
      if (!owner.isCurrent()) retire();
    });
    return () => {
      const stale = attempt.current;
      attempt.current = undefined;
      unsub?.();
      stale?.abort.abort();
    };
  }, [sourceId, owner]);

  async function start() {
    if (!callback.current || !owner?.isCurrent() || attempt.current) return;
    const run = { abort: new AbortController() };
    attempt.current = run;
    const current = () =>
      attempt.current === run && owner.isCurrent() && !run.abort.signal.aborted;
    const close = () => {
      if (attempt.current !== run) return;
      attempt.current = undefined;
      setProposal(undefined);
      setBusy(false);
    };
    run.abort.signal.addEventListener('abort', close, { once: true });
    setError(false);
    setBusy(true);
    try {
      const proposed = await generateRecordingTitle(
        sourceId,
        run.abort.signal,
        current,
      );
      if (!proposed || !current() || proposed.signal.aborted) {
        proposed?.discard();
        if (current()) setError(true);
        close();
        return;
      }
      proposed.signal.addEventListener('abort', close, { once: true });
      setProposal(proposed);
      setBusy(false);
    } catch {
      if (current()) setError(true);
      close();
    }
  }

  async function save() {
    const current = attempt.current;
    if (!current || !proposal || busy || !owner?.isCurrent()) return;
    setBusy(true);
    const title = proposal.title;
    const stored = await proposal.save();
    if (owner.isCurrent() && !current.abort.signal.aborted) {
      if (stored) callback.current?.(title);
      else setError(true);
    }
  }

  return {
    start,
    busy,
    draft: !!proposal,
    view:
      proposal || error ? (
        <View style={{ gap: 8 }}>
          {error ? (
            <AppText accessibilityRole="alert">
              {t('recording.detail.aiTitleUnavailable')}
            </AppText>
          ) : null}
          {proposal ? (
            <>
              <AppText testID="recording-title-proposal">
                {proposal.title}
              </AppText>
              <AppButton
                title={t('recording.detail.aiTitleSave')}
                disabled={busy}
                onPress={save}
                testID="recording-title-save"
              />
              <AppButton
                title={t('recording.library.cancel')}
                variant="secondary"
                disabled={busy}
                onPress={() => proposal.discard()}
              />
            </>
          ) : null}
        </View>
      ) : null,
  };
}
