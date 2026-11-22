import { useEffect, useState } from 'react';
import {
  resolvedProviderPresentation,
  type Presentation,
} from './conversationModelControlCopy';
import {
  observeConversationModelLifecycle,
  resumeSavedChatGPTTitle,
} from './conversationModelDisplayLifecycle';
import { ConversationModelSelectorControl } from './ConversationModelSelectorControl';
import {
  withOriginalChatGPTTitleOwner,
  type ReadReturningChatGPTTitle,
} from './readSavedChatGPTPresentation';
import type {
  OnDeviceSelectionWitness,
  ResolveConversationModelDisplay,
  SavedPlatformChoice,
  SelectedAiResolution,
} from './provider';
interface AiProviderSelectorRowProps {
  readonly onPress: () => void;
  readonly resolveSelectedAi: ResolveConversationModelDisplay;
  readonly revision: number;
  readonly embedded?: boolean;
}
type ScopedPresentation = {
  readonly resolve: ResolveConversationModelDisplay;
  readonly revision: number;
  readonly value: Presentation;
};
/** Reads the saved choice for display and leaves unavailable choices explicit, with no provider fallback. */
export function AiProviderSelectorRow({
  onPress,
  resolveSelectedAi,
  revision,
  embedded = false,
}: AiProviderSelectorRowProps) {
  const [scoped, setScoped] = useState<ScopedPresentation>();
  const shown: Presentation =
    scoped?.resolve === resolveSelectedAi && scoped.revision === revision
      ? scoped.value
      : { status: 'loading' };
  useEffect(() => {
    let active = true;
    let chatGPTPresentation = false;
    let readReturningTitle: ReadReturningChatGPTTitle | undefined;
    let unsubscribeCredential: (() => void) | undefined;
    let exactPlatform: SavedPlatformChoice | undefined;
    let observedName: string | undefined;
    let invalidated = false;
    let fence = 0;
    let launchedFence = 0;
    let launchedForeground = false;
    let attempt = 0;
    let waiting: Presentation | undefined;
    let ownsSelection: OnDeviceSelectionWitness | null = null;
    let unsubscribe: (() => void) | undefined;
    const publish = (value: Presentation) => {
      if (active) setScoped({ resolve: resolveSelectedAi, revision, value });
    };
    const unavailable: Presentation = { status: 'unavailable' };
    const invalidate = () => {
      invalidated = true;
      readReturningTitle = undefined;
      waiting = undefined;
      publish(unavailable);
    };
    const current = (id: number) =>
      active &&
      id === attempt &&
      !invalidated &&
      (!ownsSelection || ownsSelection.isCurrent());
    function watchCredential(credential: OnDeviceSelectionWitness) {
      unsubscribeCredential?.();
      unsubscribeCredential = credential.subscribe(invalidate);
      return credential.isCurrent();
    }
    const lifecycle = observeConversationModelLifecycle(fenced => {
      if (fenced) {
        fence++;
        waiting = undefined;
        if (chatGPTPresentation) {
          if (readReturningTitle) {
            // Retire the previous readiness, but preserve the exact local reread capability.
            attempt++;
            publish(unavailable);
          } else invalidate();
        } else if (exactPlatform) publish(unavailable);
      } else if (exactPlatform) resumePlatform();
      else if (readReturningTitle && launchedFence !== fence) {
        const id = attempt;
        const canRead = () => current(id) && lifecycle.canShowSavedName();
        if (!canRead()) return;
        launchedFence = fence;
        resumeSavedChatGPTTitle(
          readReturningTitle,
          canRead,
          watchCredential,
          publish,
        );
      } else if (chatGPTPresentation && current(attempt) && waiting) {
        const value = waiting;
        waiting = undefined;
        publish(value);
      }
    });
    const protectedPlatform = () =>
      exactPlatform !== 'pcc' ||
      (lifecycle.hasProtectedDataWitness &&
        ownsSelection?.isCurrent() === true);
    function resumePlatform() {
      if (
        !current(attempt) ||
        !exactPlatform ||
        !protectedPlatform() ||
        !lifecycle.ready()
      )
        return;
      if (launchedFence !== fence || !launchedForeground) launch(exactPlatform);
      else if (waiting) {
        const value = waiting;
        waiting = undefined;
        if (value.status !== 'saved' || lifecycle.canShowSavedName())
          publish(value);
      }
    }
    function platformResult(value: Presentation) {
      if (!protectedPlatform()) {
        publish(unavailable);
        return;
      }
      if (launchedFence !== fence || !launchedForeground) {
        resumePlatform();
        return;
      }
      if (lifecycle.ready()) publish(value);
      else waiting = value;
    }

    function launch(platformRefreshOnly?: SavedPlatformChoice) {
      const id = ++attempt;
      let settled: SelectedAiResolution | undefined;
      launchedFence = fence;
      launchedForeground = lifecycle.foreground();
      waiting = undefined;
      observedName = undefined;
      ownsSelection = null;
      unsubscribe?.();
      unsubscribe = undefined;
      unsubscribeCredential?.();
      unsubscribeCredential = undefined;
      publish({ status: 'loading' });
      resolveSelectedAi({
        platformRefreshOnly,
        selection(witness) {
          if (!current(id)) return;
          if (!witness) {
            invalidate();
            return;
          }
          ownsSelection = witness;
          unsubscribe = witness.subscribe(invalidate);
          if (!witness.isCurrent()) invalidate();
        },
        savedChatGPTName(name, credential, onReturn) {
          if (!current(id) || !ownsSelection?.isCurrent()) return;
          if (!watchCredential(credential)) {
            invalidate();
            return;
          }
          // A foreground change must not trigger a new remote catalog lookup.
          if (!lifecycle.hasProtectedDataWitness) return;
          chatGPTPresentation = true;
          readReturningTitle = withOriginalChatGPTTitleOwner(
            onReturn,
            credential,
          );
          observedName = name;
          if (!launchedForeground || launchedFence !== fence) {
            invalidate();
            return;
          }
          lifecycle.observeSavedPlatform();
          if (settled?.status === 'ready') return;
          const pend = {
            status: 'saved-chatgpt',
            name,
            local: false,
          } as const;
          const value = settled
            ? resolvedProviderPresentation(settled, undefined, name)
            : pend;
          if (lifecycle.canShowSavedName()) publish(value);
          else waiting = value;
        },
        savedPlatformName(name, platform) {
          if (!current(id)) return;
          // Classify before protection checks so a late PCC result cannot
          // escape into generic presentation when native proof is absent.
          exactPlatform = platform;
          observedName = name;
          if (!protectedPlatform()) return;
          lifecycle.observeSavedPlatform();
          if (launchedFence !== fence || !launchedForeground) {
            resumePlatform();
            return;
          }
          const value = {
            status: 'saved',
            name,
            local: platform === 'on-device',
          } as const;
          if (lifecycle.canShowSavedName()) publish(value);
          else waiting = value;
        },
      }).then(
        result => {
          if (!current(id)) return;
          settled = result;
          const value = resolvedProviderPresentation(
            result,
            exactPlatform,
            observedName,
          );
          if (exactPlatform) platformResult(value);
          else if (chatGPTPresentation && !lifecycle.ready()) waiting = value;
          else publish(value);
        },
        () => {
          if (current(id)) publish(unavailable);
        },
      );
    }
    launch();
    return () => {
      active = false;
      unsubscribe?.();
      unsubscribeCredential?.();
      lifecycle.dispose();
    };
  }, [resolveSelectedAi, revision]);
  return (
    <ConversationModelSelectorControl
      shown={shown}
      onPress={onPress}
      embedded={embedded}
    />
  );
}
