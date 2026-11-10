import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CheckboxIndicator } from '../layout/CheckboxIndicator';
import { QuestionCard } from './QuestionCard';
import { ActionButton } from './NextVisitComponents';
import { EvidenceCaveats } from './EvidenceCaveats';
import {
  inlineReviewMove,
  inlineReviewRemove,
  inlineReviewSelection,
  inlineReviewToggle,
  inlineReviewUpdate,
} from './inlineVisitReview';
import type {
  InlineVisitReview,
  InlineVisitSelection,
} from './inlineVisitReview';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestionsTheme,
} from './types';

/** A conversation owner supplies state for one message and controls save completion. */
export function InlineVisitQuestionCard<T extends NextVisitEvidenceReference>({
  state,
  onChange,
  onSave,
  onOpenSource,
  theme,
  isSaving,
  saveMessage,
}: {
  readonly state: InlineVisitReview<T>;
  readonly onChange: (state: InlineVisitReview<T>) => void;
  readonly onSave: (selection: InlineVisitSelection<T>) => Promise<void>;
  readonly onOpenSource: (reference: T) => void;
  readonly theme: NextVisitQuestionsTheme;
  readonly isSaving: boolean;
  readonly saveMessage?: string | null;
}) {
  const pending = useRef<string | null>(null);
  const selection = inlineReviewSelection(state);
  const submit = async () => {
    if (!selection || isSaving || pending.current === state.ownerKey) return;
    const ownerKey = state.ownerKey;
    pending.current = ownerKey;
    try {
      await onSave(selection);
    } catch {
      /* The owning session presents the failure. */
    } finally {
      if (pending.current === ownerKey) pending.current = null;
    }
  };
  return (
    <View testID="inline-visit-review">
      <Text accessibilityRole="header" style={{ color: theme.colors.text }}>
        진료에서 물어볼 질문
      </Text>
      {state.items.map((item, index) => {
        const id = item.question.identity!.id;
        return (
          <View key={id}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`질문 ${index + 1} 선택`}
              accessibilityState={{
                checked: item.selected,
                disabled: isSaving,
              }}
              disabled={isSaving}
              onPress={() => onChange(inlineReviewToggle(state, id))}
              style={[
                styles.selectionRow,
                { minHeight: theme.tokens.minTouchTarget },
              ]}
              testID={`inline-visit-select-${index}`}
            >
              <CheckboxIndicator
                checked={item.selected}
                color={theme.colors.accentText}
                disabled={isSaving}
              />
              <Text style={{ color: theme.colors.text }}>
                {item.origin === 'saved' ? '저장된 질문' : '새 질문'}
              </Text>
            </Pressable>
            <QuestionCard
              question={item.question}
              index={index}
              count={state.items.length}
              editable
              disabled={isSaving}
              theme={theme}
              onUpdate={update =>
                onChange(inlineReviewUpdate(state, id, update))
              }
              onMove={offset => onChange(inlineReviewMove(state, id, offset))}
              onRemove={() => onChange(inlineReviewRemove(state, id))}
              onOpenSource={onOpenSource}
            />
          </View>
        );
      })}
      <EvidenceCaveats caveats={state.caveats} theme={theme} />
      {!state.items.some(item => item.selected) ? (
        <Text style={{ color: theme.colors.textMuted }}>
          저장할 질문을 선택해 주세요.
        </Text>
      ) : null}
      {saveMessage ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {saveMessage}
        </Text>
      ) : null}
      <ActionButton
        label={isSaving ? '저장 중' : '선택한 질문 저장'}
        disabled={!selection || isSaving}
        onPress={submit}
        theme={theme}
        testID="inline-visit-save"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  selectionRow: { flexDirection: 'row', alignItems: 'center' },
});
