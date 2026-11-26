import { ConversationA2UILocalChoice } from './ConversationA2UILocalChoice';
import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import {
  localA2UICheckLabel,
  localA2UIDraftFieldLabel,
  localA2UIDraftPreviewLabel,
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
    readonly value: string | boolean;
    readonly alternate?: string;
  }>();
  useLayoutEffect(() => {
    const draft: Draft | undefined = mountConversationA2UILocalDraft(
      approved,
      surfaceId,
      () => current.current === draft && isCurrent(),
    );
    current.current = draft;
    const value = draft?.read(approved.fieldId);
    if (draft && value !== undefined)
      setState({
        draft,
        approved,
        surfaceId,
        value,
        alternate: choiceValue(approved, draft),
      });
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
      setState({
        draft,
        approved,
        surfaceId,
        value: next,
        alternate: choiceValue(approved, draft),
      });
  }
  if (approved.kind === 'choice') {
    return typeof value === 'string' ? (
      <ConversationA2UILocalChoice
        value={value}
        onChange={next => {
          if (draft.change(approved.fieldId, next)) publish();
        }}
      />
    ) : null;
  }
  if (approved.kind === 'checkbox' || approved.kind === 'paired') {
    if (typeof value !== 'boolean') return null;
    const toggle = (
      <LocalConfirmation
        value={value}
        onChange={next => {
          if (draft.change(approved.fieldId, next)) publish();
        }}
      />
    );
    if (approved.kind === 'checkbox') return toggle;
    return (
      <View>
        {toggle}
        <ConversationA2UILocalChoice
          value={state.alternate ?? ''}
          onChange={next => {
            if (draft.change(approved.choiceId, next)) publish();
          }}
        />
      </View>
    );
  }
  if (typeof value !== 'string') return null;
  const { resetId } = approved;
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
          if (draft.reset(resetId)) publish();
        }}
      >
        <AppText>{localA2UIDraftResetLabel}</AppText>
      </Pressable>
      {approved.previewId ? (
        <View accessibilityLabel={localA2UIDraftPreviewLabel}>
          <AppText allowFontScaling>{localA2UIDraftPreviewLabel}</AppText>
          <AppText
            allowFontScaling
            selectable={false}
            testID="a2ui-local-draft-preview"
          >
            {value}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** Both controls observe the same exact draft; replacement retires its two
 * callbacks together and not just the most recently edited field. */
function choiceValue(approved: ConversationA2UILocalDraft, draft: Draft) {
  const next =
    approved.kind === 'paired' ? draft.read(approved.choiceId) : undefined;
  return typeof next === 'string' ? next : undefined;
}

function LocalConfirmation({
  value,
  onChange,
}: {
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.controls}>
      <AppText allowFontScaling>{localA2UICheckLabel}</AppText>
      <Switch
        accessibilityLabel={localA2UICheckLabel}
        value={value}
        onValueChange={onChange}
      />
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
