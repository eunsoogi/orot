import { VisitQuestionTemplate } from './VisitQuestionTemplate';
import type { Appointment } from '@orot/domain';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
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
import { t } from '../i18n';
import { VisitAppointmentCard } from './VisitContextCards';

/** A conversation owner supplies state for one message and controls save completion. */
export function InlineVisitQuestionCard<T extends NextVisitEvidenceReference>({
  state,
  appointment,
  onChange,
  onSave,
  onOpenSource,
  theme,
  isSaving,
  saveMessage,
  restorationNotice,
  restorationWarning,
}: {
  readonly state: InlineVisitReview<T>;
  readonly appointment?: Appointment;
  readonly onChange: (state: InlineVisitReview<T>) => void;
  readonly onSave: (selection: InlineVisitSelection<T>) => Promise<void>;
  readonly onOpenSource: (reference: T) => void;
  readonly theme: NextVisitQuestionsTheme;
  readonly isSaving: boolean;
  readonly saveMessage?: string | null;
  readonly restorationNotice?: string;
  readonly restorationWarning?: boolean;
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
    <VisitQuestionTemplate theme={theme}>
      {appointment ? (
        <VisitAppointmentCard appointment={appointment} theme={theme} />
      ) : null}
      {state.items.map((item, index) => {
        const id = item.question.identity!.id;
        return (
          <QuestionCard
            key={id}
            compact
            priorityInDetails
            selectionControl={
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={t('visitQuestions.inline.question.select', {
                  number: index + 1,
                })}
                accessibilityState={{
                  checked: item.selected,
                  disabled: isSaving,
                }}
                disabled={isSaving}
                onPress={() => onChange(inlineReviewToggle(state, id))}
                style={[
                  styles.selectionRow,
                  {
                    minWidth: theme.tokens.minTouchTarget,
                    minHeight: theme.tokens.minTouchTarget,
                  },
                ]}
                testID={`inline-visit-select-${index}`}
              >
                <CheckboxIndicator
                  checked={item.selected}
                  color={theme.colors.accentText}
                  disabled={isSaving}
                />
              </Pressable>
            }
            question={item.question}
            index={index}
            count={state.items.length}
            editable
            disabled={isSaving}
            theme={theme}
            onUpdate={update => onChange(inlineReviewUpdate(state, id, update))}
            onMove={offset => onChange(inlineReviewMove(state, id, offset))}
            onRemove={() => onChange(inlineReviewRemove(state, id))}
            onOpenSource={onOpenSource}
          />
        );
      })}
      <EvidenceCaveats caveats={state.caveats} theme={theme} collapsed />
      {restorationNotice ? (
        <Text
          testID="inline-visit-restoration-notice"
          accessibilityRole={restorationWarning ? 'alert' : undefined}
          style={{
            color: restorationWarning
              ? theme.colors.danger
              : theme.colors.textMuted,
          }}
        >
          {restorationNotice}
        </Text>
      ) : null}
      {saveMessage ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
          {saveMessage}
        </Text>
      ) : null}
      <ActionButton
        label={
          isSaving
            ? t('visitQuestions.inline.actions.saving')
            : !selection
              ? t('visitQuestions.inline.actions.save')
              : t('visitQuestions.inline.actions.saveCount', {
                  count: state.items.filter(item => item.selected).length,
                })
        }
        disabled={!selection || isSaving}
        onPress={submit}
        theme={theme}
        testID="inline-visit-save"
      />
    </VisitQuestionTemplate>
  );
}

const styles = StyleSheet.create({
  selectionRow: { alignItems: 'center', justifyContent: 'center' },
});
