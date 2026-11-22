import { Pressable, StyleSheet } from 'react-native';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';

/** Keep real notice and coverage visible. The same action opens their untruncated text. */
export function ClassificationResultNotice({
  notice,
  summary,
  height,
  compact,
  onPress,
}: {
  readonly notice: string;
  readonly summary: string;
  readonly height: number;
  readonly compact: boolean;
  readonly onPress: () => void;
}) {
  const heading = notice || t('medicalAppointments.reviewResults');
  const maxScale = Math.max(1, (height - 4) / 38);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[heading, summary].filter(Boolean).join(', ')}
      accessibilityHint={t('medicalAppointments.openResultDetails')}
      onPress={onPress}
      style={[styles.button, { height }, compact && styles.compact]}
      testID="classification-result-notice"
    >
      <AppText
        accessibilityRole="header"
        numberOfLines={1}
        maxFontSizeMultiplier={maxScale}
        style={styles.heading}
      >
        {heading}
      </AppText>
      {summary ? (
        <AppText
          numberOfLines={1}
          maxFontSizeMultiplier={maxScale}
          style={styles.coverage}
        >
          {summary}
        </AppText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { justifyContent: 'center', paddingHorizontal: 8 },
  compact: { flex: 1, minWidth: 0 },
  heading: { fontSize: 16, lineHeight: 20, fontWeight: '700' },
  coverage: { fontSize: 13, lineHeight: 18, color: appColors.secondary },
});
