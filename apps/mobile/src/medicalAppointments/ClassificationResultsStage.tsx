import { useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { ClassificationPagedStage } from './ClassificationPagedStage';
import { ClassificationResultNotice } from './ClassificationResultNotice';
import {
  ClassificationEdgeAction,
  classificationEdgeTarget,
} from './ClassificationEdgeAction';
import {
  ClassificationResultDetail,
  type ClassificationResultField,
} from './ClassificationResultDetail';
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
  readonly details: readonly ClassificationResultField[];
}

interface Props {
  readonly rows: readonly ClassificationResultRow[];
  readonly summary: string;
  readonly notice: string;
  readonly restart: () => void;
}

export function ClassificationResultsStage({
  rows,
  summary,
  notice,
  restart,
}: Props) {
  const window = useWindowDimensions();
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState<{ id: string } | 'summary' | null>(null);
  const details =
    detail === 'summary'
      ? [
          { label: t('medicalAppointments.reviewResults'), value: summary },
          { label: t('medicalAppointments.resultStatus'), value: notice },
        ].filter(field => field.value)
      : detail
        ? rows.find(row => row.id === detail.id)?.details
        : undefined;
  const { fontScale: scale } = window;
  const { width, height } = bounds.height ? bounds : window;
  const circle = classificationCircleGeometry(width, height, scale);
  const target = classificationEdgeTarget;
  const naturalRow = Math.max(target, Math.ceil(38 * scale + 10));
  const naturalCaption = Math.max(target, Math.ceil(38 * scale + 4));
  // A short pane keeps a complete row and visible notice beside the action.
  const compact = !details && height < 3 * target + 8;
  const minimum = details
    ? Math.max(target, Math.min(160, height / 2))
    : compact
      ? target
      : 2 * target;
  const size = Math.max(
    0,
    Math.min(circle.size, Math.max(target, height - minimum - 8)),
  );
  const centerOffset = Math.max(
    0,
    Math.min((height - size) / 2, height - size - minimum - 8),
  );
  const top = compact ? target + 8 : centerOffset + size + 8;
  const available = Math.max(0, height - top);
  const captionHeight = compact
    ? 0
    : Math.min(naturalCaption, Math.max(target, available - target));
  const rowSpace = Math.max(available - captionHeight, target);
  const rowHeight = Math.min(naturalRow, rowSpace);
  const capacity = Math.min(3, Math.max(1, Math.floor(rowSpace / rowHeight)));
  const position =
    Math.floor(Math.max(0, Math.min(index, rows.length - 1)) / capacity) *
    capacity;
  const paging = rows.length > capacity;

  const actionTitle = t('medicalAppointments.restartShort');
  const actionLabel = t('medicalAppointments.startAgain');
  // No list: preserve the full measured failure reader and small-window escape.
  if (!rows.length) {
    return (
      <ClassificationPagedStage
        testID="medical-appointment-results"
        documents={[notice || summary]}
        actionTitle={actionTitle}
        actionLabel={actionLabel}
        onAction={restart}
      />
    );
  }

  const restartButton = (diameter: number) => (
    <ClassificationCircleButton
      size={diameter}
      title={actionTitle}
      label={actionLabel}
      disabled={false}
      onPress={restart}
    />
  );
  const noticeAction = (noticeHeight: number, inline: boolean) => (
    <ClassificationResultNotice
      notice={notice}
      summary={summary}
      height={noticeHeight}
      compact={inline}
      onPress={() => setDetail('summary')}
    />
  );

  return (
    <View
      style={styles.fill}
      testID="medical-appointment-results"
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
      {compact ? (
        <View style={styles.compactHeader}>
          <View style={styles.compactAction}>
            <ClassificationCircleSlot size={target} centerOffset={0}>
              {restartButton(target)}
            </ClassificationCircleSlot>
          </View>
          {noticeAction(target, true)}
        </View>
      ) : (
        <ClassificationCircleSlot size={size} centerOffset={centerOffset}>
          {restartButton(size)}
        </ClassificationCircleSlot>
      )}
      {details ? (
        <ClassificationResultDetail
          fields={details}
          top={top}
          back={() => setDetail(null)}
        />
      ) : (
        <View
          style={[styles.list, { top }]}
          testID="classification-stage-captions"
        >
          {compact ? null : noticeAction(captionHeight, false)}
          <View style={styles.band} testID="classification-result-paging">
            {paging ? (
              <ClassificationEdgeAction
                direction="left"
                label={t('medicalAppointments.previousResult')}
                testID="medical-appointment-previous-result"
                disabled={position === 0}
                onPress={() => setIndex(Math.max(0, position - capacity))}
              />
            ) : null}
            <View style={styles.rows} testID="classification-result-list">
              {rows.slice(position, position + capacity).map(row => (
                <Pressable
                  key={row.id}
                  style={[styles.result, { height: rowHeight }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title}, ${row.when}, ${row.category}`}
                  accessibilityHint={t('medicalAppointments.openResultDetails')}
                  onPress={() => setDetail({ id: row.id })}
                  testID="classification-result-row"
                >
                  <AppText
                    numberOfLines={1}
                    maxFontSizeMultiplier={
                      rowHeight < naturalRow
                        ? Math.max(1, rowHeight / 21)
                        : undefined
                    }
                    style={styles.title}
                  >
                    {row.title}
                  </AppText>
                  {rowHeight >= naturalRow ? (
                    <AppText numberOfLines={1} style={styles.time}>
                      {row.when} · {row.category}
                    </AppText>
                  ) : null}
                </Pressable>
              ))}
            </View>
            {paging ? (
              <ClassificationEdgeAction
                direction="right"
                label={t('medicalAppointments.nextResult')}
                testID="medical-appointment-next-result"
                disabled={position + capacity >= rows.length}
                onPress={() => setIndex(position + capacity)}
              />
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, width: '100%' },
  list: {
    position: 'absolute',
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  band: { flexDirection: 'row', alignItems: 'center' },
  rows: { flex: 1, minWidth: 0 },
  compactHeader: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    maxWidth: 520,
    width: '100%',
  },
  compactAction: {
    width: classificationEdgeTarget,
    height: classificationEdgeTarget,
  },
  result: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  title: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  time: { fontSize: 13, lineHeight: 17, color: appColors.secondary },
});
