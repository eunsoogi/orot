import { useEffect, useState } from 'react';
import { APPLE_PCC_PROVIDER_ID, APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { StyleSheet, View } from 'react-native';
import { t } from '../../i18n';
import { observeConversationModelLifecycle } from './conversationModelDisplayLifecycle';
import { SelectedModelControl } from '../../layout/SelectedModelControl';
import type {
  OnDeviceSelectionWitness,
  ResolveConversationModelDisplay,
  SavedPlatformChoice,
} from './provider';

interface AiProviderSelectorRowProps {
  readonly onPress: () => void;
  readonly resolveSelectedAi: ResolveConversationModelDisplay;
  readonly revision: number;
  readonly embedded?: boolean;
}

type Presentation =
  | { readonly status: 'loading' | 'selection-required' | 'unavailable' }
  | {
      readonly status: 'saved' | 'ready';
      readonly name: string;
      readonly local: boolean;
    };

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
    let exactPlatform: SavedPlatformChoice | undefined;
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
      waiting = undefined;
      publish(unavailable);
    };
    const current = (id: number) =>
      active &&
      id === attempt &&
      !invalidated &&
      (!ownsSelection || ownsSelection.isCurrent());

    const lifecycle = observeConversationModelLifecycle(fenced => {
      if (fenced) {
        fence++;
        waiting = undefined;
        if (exactPlatform) publish(unavailable);
      } else if (exactPlatform) resumePlatform();
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
      launchedFence = fence;
      launchedForeground = lifecycle.foreground();
      waiting = undefined;
      ownsSelection = null;
      unsubscribe?.();
      unsubscribe = undefined;
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
        savedPlatformName(name, platform) {
          if (!current(id)) return;
          // Classify before protection checks so a late PCC result cannot
          // escape into generic presentation when native proof is absent.
          exactPlatform = platform;
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
          // A verified resolver result is not a presentation witness. A
          // resolver without the exact saved-choice callback cannot expose PCC.
          if (
            result.status === 'ready' &&
            result.selection.providerId === APPLE_PCC_PROVIDER_ID &&
            exactPlatform !== 'pcc'
          ) {
            publish(unavailable);
            return;
          }
          const value: Presentation =
            result.status === 'ready'
              ? {
                  status: 'ready',
                  name: result.option.displayName,
                  local: result.selection.providerId === APPLE_PROVIDER_ID,
                }
              : { status: result.status };
          if (exactPlatform) platformResult(value);
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
      lifecycle.dispose();
    };
  }, [resolveSelectedAi, revision]);

  const named = shown.status === 'ready' || shown.status === 'saved';
  const value = named
    ? shown.name
    : shown.status === 'selection-required'
      ? t('provider.selection.rowPrompt')
      : shown.status === 'loading'
        ? t('provider.selection.rowLoading')
        : t('provider.selection.rowUnavailable');
  const rowLabel = `${t('provider.selection.rowTitle')}, ${value}`;

  return (
    <View style={!embedded && styles.inset}>
      <SelectedModelControl
        name={value}
        local={named && shown.local}
        label={rowLabel}
        hint={t('provider.selection.rowHint')}
        busy={shown.status === 'loading' || shown.status === 'saved'}
        onPress={onPress}
        testID="ai-feature-select-provider"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inset: { marginHorizontal: 20, marginVertical: 8 },
});
