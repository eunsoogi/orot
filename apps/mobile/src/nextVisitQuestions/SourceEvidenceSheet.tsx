import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { nextVisitQuestionsCopy as copy } from './copy';
import type {
  NextVisitEvidenceReference,
  NextVisitQuestionsTheme,
} from './types';

interface SourceEvidenceSheetProps<
  TReference extends NextVisitEvidenceReference,
> {
  readonly reference: TReference | null;
  readonly theme: NextVisitQuestionsTheme;
  readonly onClose: () => void;
}

/** Shows only the cited excerpt the user opened; source access and revalidation remain with the adapter. */
export function SourceEvidenceSheet<
  TReference extends NextVisitEvidenceReference,
>({ reference, theme, onClose }: SourceEvidenceSheetProps<TReference>) {
  const styles = createEvidenceStyles(theme);
  const time = reference?.effectiveTime
    ? formatEvidenceTime(reference.effectiveTime)
    : copy.evidence.noDate;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={reference !== null}
    >
      <View accessibilityViewIsModal style={styles.backdrop}>
        <ScrollView
          contentContainerStyle={styles.sheet}
          testID="next-visit-source-sheet"
        >
          {reference ? (
            <>
              <Text accessibilityRole="header" style={textStyle(theme, true)}>
                {copy.evidence.heading}
              </Text>
              <Text style={textStyle(theme)}>
                {sourceLabel(reference.sourceKind)} · {time}
              </Text>
              <Text style={textStyle(theme)}>
                {reviewStateLabel(reference.reviewState)}
              </Text>
              <Text
                selectable
                style={textStyle(theme)}
                testID="next-visit-source-content"
              >
                {reference.content}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={styles.closeButton}
                testID="next-visit-source-close"
              >
                <Text style={styles.closeText}>{copy.evidence.close}</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function createEvidenceStyles(theme: NextVisitQuestionsTheme) {
  const { colors, tokens } = theme;
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: '#00000066',
    },
    sheet: {
      gap: tokens.spacing.md,
      padding: tokens.spacing.lg,
      borderTopLeftRadius: tokens.radii.card,
      borderTopRightRadius: tokens.radii.card,
      backgroundColor: colors.surface,
    },
    closeButton: {
      minHeight: tokens.minTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens.radii.control,
      backgroundColor: colors.accent,
    },
    closeText: {
      color: colors.onAccent,
      fontSize: tokens.typography.sizes.body,
      fontWeight: tokens.typography.weights.semibold,
    },
  });
}

function textStyle(theme: NextVisitQuestionsTheme, heading = false) {
  return {
    color: heading ? theme.colors.text : theme.colors.textMuted,
    fontSize: heading
      ? theme.tokens.typography.sizes.heading
      : theme.tokens.typography.sizes.body,
    fontWeight: heading
      ? theme.tokens.typography.weights.bold
      : theme.tokens.typography.weights.regular,
    lineHeight: theme.tokens.typography.sizes.body * 1.45,
  } as const;
}

function sourceLabel(kind: NextVisitEvidenceReference['sourceKind']): string {
  switch (kind) {
    case 'personal_record':
      return copy.evidence.personalRecord;
    case 'reviewed_memory':
      return copy.evidence.reviewedMemory;
    case 'external_medical':
      return copy.evidence.externalMedical;
  }
}

function reviewStateLabel(
  state: NextVisitEvidenceReference['reviewState'],
): string {
  switch (state) {
    case 'reviewed':
      return copy.evidence.reviewed;
    case 'unreviewed':
      return copy.evidence.unreviewed;
    case 'unknown':
      return copy.evidence.unknown;
  }
}

function formatEvidenceTime(value: string): string {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return copy.evidence.noDate;
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(instant);
}
