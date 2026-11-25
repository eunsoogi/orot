import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import {
  localA2UIDraftFieldLabel,
  localA2UIDraftResetLabel,
  mountConversationA2UILocalDraft,
  type ConversationA2UILocalDraft,
} from './conversationA2UILocalDraft';

interface Props {
  readonly approved: ConversationA2UILocalDraft;
  readonly surfaceId: string;
  readonly isCurrent: () => boolean;
  readonly subscribe?: (listener: () => void) => () => void;
}

type Draft = NonNullable<ReturnType<typeof mountConversationA2UILocalDraft>>;

export function ConversationA2UILocalDraftControls({
  approved,
  surfaceId,
  isCurrent,
  subscribe,
}: Props) {
  const current = useRef<Draft | undefined>(undefined);
  const [state, setState] = useState<{
    readonly draft: Draft;
    readonly approved: ConversationA2UILocalDraft;
    readonly surfaceId: string;
    readonly value: string;
  }>();
  useLayoutEffect(() => {
    const draft: Draft | undefined = mountConversationA2UILocalDraft(
      approved,
      surfaceId,
      () => current.current === draft && isCurrent(),
    );
    current.current = draft;
    if (draft && draft.read(approved.fieldId) !== undefined)
      setState({ draft, approved, surfaceId, value: '' });
    const stop = subscribe?.(() => {
      if (!isCurrent()) {
        draft?.retire();
        setState(undefined);
      }
    });
    return () => {
      stop?.();
      draft?.retire();
      if (current.current === draft) current.current = undefined;
    };
  }, [approved, isCurrent, subscribe, surfaceId]);

  if (state?.approved !== approved || state.surfaceId !== surfaceId)
    return null;
  const { draft, value } = state;
  function publish() {
    const next = draft.read(approved.fieldId);
    if (next !== undefined && current.current === draft)
      setState({ draft, approved, surfaceId, value: next });
  }
  return (
    <View style={styles.controls}>
      <AppText>{localA2UIDraftFieldLabel}</AppText>
      <TextInput
        accessibilityLabel={localA2UIDraftFieldLabel}
        autoComplete="off"
        autoCorrect={false}
        maxLength={256}
        spellCheck={false}
        textContentType="none"
        value={value}
        style={styles.field}
        onChangeText={next => {
          if (draft.change(approved.fieldId, next)) publish();
        }}
      />
      <Pressable
        accessibilityRole="button"
        style={styles.reset}
        onPress={() => {
          if (draft.reset(approved.resetId)) publish();
        }}
      >
        <AppText>{localA2UIDraftResetLabel}</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { gap: 8, marginTop: 8 },
  reset: { minHeight: 44, justifyContent: 'center' },
  field: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: appColors.primarySoft,
  },
});
