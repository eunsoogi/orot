import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';

export interface ClassificationCaptionCopy {
  readonly title: string;
  readonly supporting: string;
  readonly privacy: string;
  readonly warning: string;
}

/** One typography stack, used for measured fallback admission and for display.
 * The invisible native measuring twin is never announced or interactive. */
export function ClassificationConfirmationCaption({
  copy,
  measuring = false,
  onLayout,
}: {
  readonly copy: ClassificationCaptionCopy;
  readonly measuring?: boolean;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
}) {
  return (
    <View
      testID={
        measuring
          ? 'classification-caption-measurement'
          : 'classification-confirmation-caption'
      }
      accessibilityElementsHidden={measuring}
      importantForAccessibility={measuring ? 'no-hide-descendants' : 'auto'}
      pointerEvents={measuring ? 'none' : 'auto'}
      style={[styles.stack, measuring && styles.measure]}
      onLayout={onLayout}
    >
      <AppText accessibilityRole="header" style={styles.title}>
        {copy.title}
      </AppText>
      <AppText style={styles.supporting}>{copy.supporting}</AppText>
      <AppText
        testID={measuring ? undefined : 'classification-confirmation-privacy'}
        style={styles.privacy}
      >
        {copy.privacy}
      </AppText>
      {copy.warning ? (
        <AppText accessibilityRole="alert" style={styles.warning}>
          {copy.warning}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  measure: { position: 'absolute', opacity: 0, top: 0 },
  title: {
    textAlign: 'center',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  supporting: {
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
    color: appColors.primaryText,
  },
  privacy: {
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    color: appColors.secondary,
    marginTop: 4,
  },
  warning: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
    color: appColors.danger,
  },
});
