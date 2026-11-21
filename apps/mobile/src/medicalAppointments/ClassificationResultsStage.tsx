import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { ClassificationPagedStage } from './ClassificationPagedStage';
import { ClassificationPagingActions } from './ClassificationPagingActions';
import {
  ClassificationCircleButton,
  ClassificationCircleSlot,
  classificationCircleGeometry,
} from './ClassificationCircle';

export interface ClassificationResultRow {
  readonly id: string;
  readonly title: string;
  readonly when: string;
  readonly category: string;
  readonly details: string;
}

interface Props {
  readonly rows: readonly ClassificationResultRow[];
  readonly summary: string;
  readonly notice: string;
  readonly restart: () => void;
}

const stageID = 'medical-appointment-results';
const rowMin = (scale: number) => Math.max(44, Math.ceil(38 * scale + 10));
const footerMin = (scale: number) => Math.max(44, Math.ceil(22 * scale + 12));

/** Fit full two-line rows in the measured lane before adding a page. Reserve
 * controls only when they are useful; large text never forces a partial row. */
export function classificationResultsPageSize(
  available: number,
  count: number,
  row: number,
  footer: number,
): number {
  if (count * row <= available) return count;
  return Math.max(0, Math.floor((available - footer) / row));
}

export function ClassificationResultsStage({
  rows,
  summary,
  notice,
  restart,
}: Props) {
  const window = useWindowDimensions();
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [footerHeight, setFooterHeight] = useState(0);
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState<string | null>(null);
  const selected = rows.find(row => row.id === detail);
  const width = bounds.width || window.width;
  const height = bounds.height || window.height;
  const geometry = classificationCircleGeometry(
    width,
    height,
    window.fontScale,
  );
  const rowHeight = rowMin(window.fontScale);
  const captionHeight = Math.max(30, Math.ceil(20 * window.fontScale + 10));
  const available = Math.max(0, height - geometry.captionTop - captionHeight);
  const capacity = classificationResultsPageSize(
    available,
    rows.length,
    rowHeight,
    Math.max(footerMin(window.fontScale), footerHeight),
  );
  const position =
    capacity > 0
      ? Math.floor(Math.min(index, rows.length - 1) / capacity) * capacity
      : 0;
  const compact = capacity === 0;
  const restartTitle = t('medicalAppointments.restartShort');
  const restartLabel = t('medicalAppointments.startAgain');

  const updateBounds = (layout: { width: number; height: number }) => {
    setBounds(old =>
      old.width === layout.width && old.height === layout.height
        ? old
        : { width: layout.width, height: layout.height },
    );
  };
  if (!rows.length)
    return (
      <ClassificationPagedStage
        testID={stageID}
        documents={[notice || summary]}
        actionTitle={restartTitle}
        actionLabel={restartLabel}
        onAction={restart}
      />
    );
  // When even one complete row plus paging cannot fit, retain the existing
  // measured line reader and its full-window escape instead of hiding results.
  if (selected || detail === 'summary' || compact) {
    const documents = selected
      ? [selected.details]
      : detail === 'summary'
        ? [[notice, summary].filter(Boolean).join('\n\n')]
        : rows.map((row, ordinal) =>
            ordinal === 0
              ? [row.details, notice, summary].filter(Boolean).join('\n\n')
              : row.details,
          );
    return (
      <View
        style={styles.fill}
        testID={stageID}
        onLayout={event => updateBounds(event.nativeEvent.layout)}
      >
        <ClassificationPagedStage
          testID="classification-result-reader"
          documents={documents}
          actionTitle={
            detail ? t('medicalAppointments.listShort') : restartTitle
          }
          actionLabel={
            detail ? t('medicalAppointments.backToResults') : restartLabel
          }
          onAction={detail ? () => setDetail(null) : restart}
        />
      </View>
    );
  }

  const size = Math.max(1, capacity);
  return (
    <View
      style={styles.fill}
      testID={stageID}
      onLayout={event => updateBounds(event.nativeEvent.layout)}
    >
      <ClassificationCircleSlot {...geometry}>
        <ClassificationCircleButton
          size={geometry.size}
          title={restartTitle}
          label={restartLabel}
          disabled={false}
          onPress={restart}
        />
      </ClassificationCircleSlot>
      <View
        style={[styles.list, { top: geometry.captionTop }]}
        testID="classification-stage-captions"
      >
        <View testID="classification-result-list">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={[
              t('medicalAppointments.reviewResults'),
              notice,
              summary,
            ]
              .filter(Boolean)
              .join(', ')}
            accessibilityHint={t('medicalAppointments.openResultDetails')}
            onPress={() => setDetail('summary')}
            style={[styles.summary, { height: captionHeight }]}
          >
            <AppText
              accessibilityRole="header"
              numberOfLines={1}
              style={styles.heading}
            >
              {notice || t('medicalAppointments.reviewResults')}
            </AppText>
          </Pressable>
          {rows.slice(position, position + size).map(row => (
            <Pressable
              key={row.id}
              style={[styles.result, { height: rowHeight }]}
              accessibilityRole="button"
              accessibilityLabel={`${row.title}, ${row.when}, ${row.category}`}
              accessibilityHint={t('medicalAppointments.openResultDetails')}
              onPress={() => setDetail(row.id)}
              testID="classification-result-row"
            >
              <AppText numberOfLines={1} style={styles.title}>
                {row.title}
              </AppText>
              <AppText numberOfLines={1} style={styles.time}>
                {row.when} · {row.category}
              </AppText>
            </Pressable>
          ))}
        </View>
        {rows.length > size ? (
          <View
            testID="classification-stage-footer"
            onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}
          >
            <ClassificationPagingActions
              previousDisabled={position === 0}
              nextDisabled={position + size >= rows.length}
              onPrevious={() => setIndex(Math.max(0, position - size))}
              onNext={() => setIndex(position + size)}
              showPaging
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, width: '100%' },
  list: {
    position: 'absolute',
    width: '100%',
    bottom: 0,
    maxWidth: 520,
    alignSelf: 'center',
  },
  summary: { justifyContent: 'center', paddingHorizontal: 8 },
  heading: { fontSize: 16, lineHeight: 20, fontWeight: '700' },
  result: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  time: { fontSize: 13, lineHeight: 17, color: appColors.secondary },
});
