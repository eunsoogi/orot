import { useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { ClassificationPagedStage } from './ClassificationPagedStage';
import { ClassificationResultNotice } from './ClassificationResultNotice';
import { useClassificationResultGroupTop } from './useClassificationResultGroupTop';
import {
  classificationResultMaxWidth,
  classificationResultStyles as styles,
} from './classificationResultStyles';
import { useClassificationListEdge } from './useClassificationListEdge';
import { classificationEdgeTarget } from './ClassificationEdgeAction';
import {
  ClassificationResultDetail,
  type ClassificationResultField,
} from './ClassificationResultDetail';
import {
  ClassificationCircleButton,
  ClassificationCircleSlot,
  classificationCircleGeometry,
  classificationDockGeometry,
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
  readonly routeRightGutter?: number;
  readonly routeOwnerWidth?: number;
  readonly movingCircle?: ReturnType<typeof classificationDockGeometry>;
}

export function ClassificationResultsStage({
  rows,
  summary,
  notice,
  restart,
  movingCircle,
  routeRightGutter = 0,
  routeOwnerWidth = 0,
}: Props) {
  const window = useWindowDimensions();
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
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
  // Keep the viewport the same size while a detail covers it. Resizing a
  // hidden scroll view near its bottom would clamp the remembered offset.
  const compact = movingCircle ? movingCircle.inline : height < 3 * target + 8;
  const minimum = naturalCaption + naturalRow;
  const size = Math.max(
    0,
    Math.min(circle.size, Math.max(target, height - minimum - 8)),
  );
  const centerOffset = Math.max(
    0,
    Math.min((height - size) / 2, height - size - minimum - 8),
  );
  const top = compact
    ? target + 8
    : movingCircle
      ? movingCircle.captionTop
      : centerOffset + size + 8;
  const sideStart = movingCircle?.side ? movingCircle.listStart : undefined;
  const stackedBottom = movingCircle?.bottomInset ?? 0;
  const captionHeight = Math.min(
    naturalCaption,
    Math.max(target, height - top - stackedBottom - target),
  );
  const showingDetail = Boolean(details);
  const side = movingCircle?.side === true;
  const { groupTop, onContentSizeChange } = useClassificationResultGroupTop({
    side,
    height,
    width: width - (movingCircle?.listStart ?? 0),
    scale,
    captionHeight,
    naturalRow,
    count: rows.length,
    top,
  });
  const bottom = side ? groupTop : stackedBottom;
  const centeredInset = side
    ? 0
    : Math.max(0, (bounds.width - classificationResultMaxWidth) / 2);
  const edge = useClassificationListEdge(
    bounds.width > 0 ? routeOwnerWidth : 0,
    routeRightGutter + centeredInset,
  );
  const actionTitle = t('medicalAppointments.restartShort');
  const actionLabel = t('medicalAppointments.startAgain');
  // No list: preserve the full measured failure reader and small-window escape.
  if (!rows.length && !movingCircle) {
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
            {!movingCircle && (
              <ClassificationCircleSlot size={target} centerOffset={0}>
                {restartButton(target)}
              </ClassificationCircleSlot>
            )}
          </View>
          {!showingDetail && noticeAction(target, true)}
        </View>
      ) : !movingCircle ? (
        <ClassificationCircleSlot size={size} centerOffset={centerOffset}>
          {restartButton(size)}
        </ClassificationCircleSlot>
      ) : null}
      {/* Keep the native scroll view mounted at its original offset. When the
          reader owns the surface, hidden rows cannot take touches or AX focus. */}
      <View
        style={[
          sideStart === undefined
            ? styles.list
            : [styles.sideList, { left: sideStart }],
          { top: groupTop, bottom },
          showingDetail && styles.hidden,
        ]}
        testID="classification-result-group"
        pointerEvents={showingDetail ? 'none' : 'auto'}
        accessibilityElementsHidden={showingDetail}
        importantForAccessibility={
          showingDetail ? 'no-hide-descendants' : 'auto'
        }
      >
        {!compact && noticeAction(captionHeight, false)}
        {rows.length > 0 && (
          <ScrollView
            {...edge.indicatorProps}
            style={[styles.viewport, edge.scrollViewStyle]}
            onContentSizeChange={onContentSizeChange}
            contentContainerStyle={[styles.rows, edge.contentStyle]}
            alwaysBounceVertical={false}
            contentInsetAdjustmentBehavior="never"
            testID="classification-result-list"
          >
            {rows.map(row => (
              <Pressable
                key={row.id}
                style={[styles.result, { minHeight: naturalRow }]}
                accessibilityRole="button"
                accessibilityLabel={`${row.title}, ${row.when}, ${row.category}`}
                accessibilityHint={t('medicalAppointments.openResultDetails')}
                onPress={() => setDetail({ id: row.id })}
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
          </ScrollView>
        )}
      </View>
      {details && (
        <ClassificationResultDetail
          fields={details}
          top={top}
          sideStart={sideStart}
          bottom={stackedBottom}
          back={() => setDetail(null)}
        />
      )}
    </View>
  );
}
