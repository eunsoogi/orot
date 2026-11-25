import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useAssistantAppearance } from '../assistantAppearance/AssistantAppearanceProvider';
import { defaultAssistantName } from '../assistantAppearance/appearance';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { createConversationRetentionReadActions } from './conversationRetentionReadActions';

type Quote = NonNullable<
  Awaited<
    ReturnType<
      ReturnType<
        typeof createConversationRetentionReadActions
      >['readExplicitPriorVoiceContext']
    >
  >
>;
export type ReadObservedVoiceQuote = (
  signal: AbortSignal,
) => Promise<Quote | undefined>;

function observedTurns(lines: Quote['lines']) {
  const turns: Array<Quote['lines'][number]> = [];
  let previousOrder: number | undefined;
  for (const line of lines) {
    const previous = turns.at(-1);
    // The stored Live wire entries are additive deltas. Preserve literal spacing,
    // and never merge across an observed speaker change or a gap in the sequence.
    if (
      previous?.role === line.role &&
      previousOrder !== undefined &&
      line.order === previousOrder + 1
    ) {
      turns[turns.length - 1] = {
        ...previous,
        text: previous.text + line.text,
      };
    } else {
      turns.push(line);
    }
    previousOrder = line.order;
  }
  return turns;
}

/** Explicit tap reveals only this locally owned quote. It never changes the composer or provider input. */
export function ConversationObservedVoiceQuote({
  read,
}: {
  readonly read: ReadObservedVoiceQuote;
}) {
  const appearance = useAssistantAppearance();
  const assistantName = appearance?.value?.name ?? defaultAssistantName;
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState<Quote | 'loading' | 'unavailable' | null>(
    null,
  );
  useEffect(() => {
    const reset = () => {
      active.current?.abort();
      active.current = null;
    };
    const subscription = AppState.addEventListener('change', phase => {
      if (phase !== 'active') {
        reset();
        setState(null);
      }
    });
    return () => {
      reset();
      subscription.remove();
    };
  }, []);
  const toggle = () => {
    active.current?.abort();
    active.current = null;
    if (state || AppState.currentState !== 'active') {
      setState(null);
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setState('loading');
    read(controller.signal)
      .then(quote => {
        if (!controller.signal.aborted && AppState.currentState === 'active')
          setState(quote ?? 'unavailable');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('unavailable');
      });
  };
  return (
    <View style={styles.rows}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: state !== null }}
        onPress={toggle}
        hitSlop={8}
      >
        <AppText style={styles.action}>
          {t(
            state
              ? 'ragConversation.voice.hideObservedCaptions'
              : 'ragConversation.voice.showObservedCaptions',
          )}
        </AppText>
      </Pressable>
      {state === 'loading' ? (
        <AppText>{t('ragConversation.voice.loadingObservedCaptions')}</AppText>
      ) : null}
      {state === 'unavailable' ? (
        <AppText>
          {t('ragConversation.voice.unavailableObservedCaptions')}
        </AppText>
      ) : null}
      {state && typeof state === 'object' ? (
        <>
          <AppText style={styles.notice}>
            {t('ragConversation.voice.observedCaptionsNotice')}
          </AppText>
          {observedTurns(state.lines).map(line => (
            <AppText key={line.order}>
              {line.role === 'user'
                ? t('ragConversation.voice.observedUser')
                : assistantName}
              : {line.text}
            </AppText>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 6 },
  action: { color: appColors.text, fontWeight: '600' },
  notice: { color: appColors.secondary, fontSize: 13 },
});
