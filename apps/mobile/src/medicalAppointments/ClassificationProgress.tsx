import { useClassificationProgressMotion } from './useClassificationProgressMotion';
import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import {
  classificationCircleGeometry,
  ClassificationCircleSlot,
} from './ClassificationCircle';

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
  const geometry = classificationCircleGeometry(
    width,
    height,
    window.fontScale,
  );
  const { size, captionTop } = geometry;
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
      <ClassificationCircleSlot {...geometry}>
        <ClassificationProgressRing
          classified={classified}
          total={total}
          saving={saving}
          size={size}
        />
      </ClassificationCircleSlot>
      <ClassificationProgressCaption
        saving={saving}
        top={captionTop}
        height={height}
        fontScale={window.fontScale}
      />
    </View>
  );
}
const progressLabel = (saving: boolean) =>
  t(
    saving
      ? 'medicalAppointments.savingResults'
      : 'medicalAppointments.progress',
  );

/** Only the drawn arc eases; accessibility always exposes the validated count. */
export function ClassificationProgressRing({
  classified,
  total,
  saving,
  size,
}: {
  readonly classified: number;
  readonly total: number;
  readonly saving: boolean;
  readonly size: number;
}) {
  const percent =
    total > 0 ? Math.floor((100 * Math.min(classified, total)) / total) : 0;
  const shown = useClassificationProgressMotion(percent);
  const label = progressLabel(saving);
  const circumference = 2 * Math.PI * 44;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={{ width: size, height: size }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100" accessible={false}>
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
          testID="classification-progress-arc"
          strokeDashoffset={circumference * (1 - shown / 100)}
          rotation={-90}
          origin="50, 50"
        />
      </Svg>
      <View pointerEvents="none" style={styles.number}>
        {/* The decorative numeral follows circle size; the progressbar exposes the complete spoken value/status. */}
        <AppText
          testID="classification-progress-number"
          allowFontScaling={false}
          style={[styles.percent, { fontSize: Math.min(32, size * 0.22) }]}
        >
          {shown}%
        </AppText>
      </View>
    </View>
  );
}

export function ClassificationProgressCaption({
  saving,
  top,
  height,
  fontScale,
}: {
  readonly saving: boolean;
  readonly top: number;
  readonly height: number;
  readonly fontScale: number;
}) {
  return height - top >= fontScale * 20 ? (
    <AppText accessibilityLiveRegion="polite" style={[styles.label, { top }]}>
      {progressLabel(saving)}
    </AppText>
  ) : null;
}

const styles = StyleSheet.create({
  content: { flex: 1, width: '100%', minHeight: 0 },
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
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 17,
  },
});
