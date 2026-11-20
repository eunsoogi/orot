import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

/** Counts validated classifications, never time or predicted model completion. */
export function ClassificationProgress({
  classified,
  total,
  saving,
}: {
  readonly classified: number;
  readonly total: number;
  readonly saving: boolean;
}) {
  const window = useWindowDimensions();
  const [bounds, setBounds] = useState({
    width: window.width,
    height: window.height,
  });
  const { width, height } = bounds;
  const percent =
    total > 0 ? Math.floor((100 * Math.min(classified, total)) / total) : 0;
  const size = Math.max(0, Math.min(240, width * 0.55, height * 0.65));
  const label = t(
    saving
      ? 'medicalAppointments.savingResults'
      : 'medicalAppointments.progress',
  );
  const showLabel = height >= size + window.fontScale * 24 + 24;
  const circumference = 2 * Math.PI * 44;
  return (
    <View
      style={styles.content}
      testID="medical-appointment-progress"
      onLayout={event => {
        const { width: nextWidth, height: nextHeight } =
          event.nativeEvent.layout;
        setBounds(old =>
          old.width === nextWidth && old.height === nextHeight
            ? old
            : { width: nextWidth, height: nextHeight },
        );
      }}
    >
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: percent }}
        style={{ width: size, height: size }}
      >
        <Svg
          width="100%"
          height="100%"
          viewBox="0 0 100 100"
          accessible={false}
        >
          <Circle
            cx={50}
            cy={50}
            r={44}
            stroke={appColors.border}
            strokeWidth={7}
            fill="none"
          />
          <Circle
            cx={50}
            cy={50}
            r={44}
            stroke={appColors.primaryText}
            strokeWidth={7}
            fill="none"
            strokeDasharray={[circumference, circumference]}
            strokeDashoffset={circumference * (1 - percent / 100)}
            rotation={-90}
            origin="50, 50"
          />
        </Svg>
        <View pointerEvents="none" style={styles.number}>
          {/* The decorative numeral follows circle size; the progressbar exposes the complete spoken value/status. */}
          <AppText
            allowFontScaling={false}
            style={[styles.percent, { fontSize: Math.min(32, size * 0.22) }]}
          >
            {percent}%
          </AppText>
        </View>
      </View>
      {showLabel ? (
        <AppText accessibilityLiveRegion="polite" style={styles.label}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  number: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: { fontSize: 32, fontWeight: '700' },
  label: { textAlign: 'center', fontSize: 17 },
});
