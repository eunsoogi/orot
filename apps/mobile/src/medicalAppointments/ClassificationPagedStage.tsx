import { useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import {
  ClassificationReaderFrame,
  useClassificationReaderFrame,
} from './ClassificationReaderFrame';
import { ClassificationPagingActions } from './ClassificationPagingActions';
import {
  paginateClassificationLines,
  type ClassificationTextLine,
} from './classificationTextPagination';

interface Props {
  readonly documents: readonly string[];
  readonly actionTitle: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly disabled?: boolean;
  readonly testID: string;
  readonly supplementaryAction?: {
    readonly title: string;
    readonly onPress: () => void;
  };
}

/** A measured, non-scrolling reader keeps even one long event reachable without shrinking Dynamic Type. */
export function ClassificationPagedStage(props: Props) {
  const { fontScale } = useWindowDimensions();
  const frame = useClassificationReaderFrame(props.onAction, props.documents);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [footerHeight, setFooterHeight] = useState(0);
  const [documentIndex, setDocumentIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const index = Math.min(
    documentIndex,
    Math.max(0, props.documents.length - 1),
  );
  const text = props.documents[index] ?? '';
  const identity = JSON.stringify([text, bounds.width, fontScale]);
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const [measurement, setMeasurement] = useState<{
    key: string;
    lines: readonly ClassificationTextLine[];
  } | null>(null);
  // The fixed footer contains both paging and primary actions, rather than stacking controls below clipped text.
  const available = Math.max(0, bounds.height - footerHeight - 12);
  const compactActions =
    bounds.height > 0 && bounds.height < 26 * fontScale * 3 + 100;
  const lines = measurement?.key === identity ? measurement.lines : null;
  const pages =
    lines && available > 0
      ? paginateClassificationLines(lines, available)
      : [text];
  const page = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const cannotFitLine = Boolean(lines?.some(line => line.height > available));
  const requiresExpansion = cannotFitLine && !frame.expanded;
  const naturalHeight =
    lines?.reduce((sum, line) => sum + line.height, 0) ?? available;
  const viewportHeight = cannotFitLine ? 0 : Math.min(available, naturalHeight);
  const previous = () => {
    if (page > 0) setPageIndex(page - 1);
    else {
      setDocumentIndex(index - 1);
      setPageIndex(Number.MAX_SAFE_INTEGER);
    }
  };
  const next = () => {
    if (page < pages.length - 1) setPageIndex(page + 1);
    else {
      setDocumentIndex(index + 1);
      setPageIndex(0);
    }
  };
  return (
    <ClassificationReaderFrame {...frame}>
      <View
        style={styles.fill}
        testID={props.testID}
        onLayout={event => {
          const { width, height } = event.nativeEvent.layout;
          setBounds(old =>
            old.width === width && old.height === height
              ? old
              : { width, height },
          );
        }}
      >
        <View style={styles.group}>
          <View
            style={[
              styles.viewport,
              {
                height: viewportHeight,
              },
            ]}
            testID="classification-text-viewport"
          >
            <Text
              key={identity}
              style={[styles.text, styles.measurement]}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="classification-text-measurement"
              onTextLayout={event => {
                if (latestIdentity.current !== identity) return;
                setMeasurement({
                  key: identity,
                  lines: event.nativeEvent.lines,
                });
              }}
            >
              {text}
            </Text>
            {!cannotFitLine ? (
              <View style={styles.reader}>
                <Text
                  style={styles.text}
                  testID="classification-page-text"
                  accessibilityLiveRegion="polite"
                  accessibilityHint={t('medicalAppointments.resultPosition', {
                    current: page + 1,
                    total: pages.length,
                  })}
                  // Before native metrics arrive this bounded first frame cannot paint over the actions.
                  numberOfLines={
                    lines
                      ? undefined
                      : Math.max(1, Math.floor(available / (26 * fontScale)))
                  }
                >
                  {pages[page]?.split('\n\n').map((paragraph, item, all) => (
                    <Text key={item}>
                      {paragraph}
                      {item < all.length - 1 ? '\n\n' : ''}
                    </Text>
                  ))}
                </Text>
              </View>
            ) : null}
          </View>
          <View
            testID="classification-stage-footer"
            style={styles.footer}
            onLayout={event => setFooterHeight(event.nativeEvent.layout.height)}
          >
            <ClassificationPagingActions
              previousDisabled={cannotFitLine || (index === 0 && page === 0)}
              nextDisabled={
                cannotFitLine ||
                (index === props.documents.length - 1 &&
                  page === pages.length - 1)
              }
              onPrevious={previous}
              onNext={next}
              compact={compactActions || cannotFitLine}
              actionTitle={
                requiresExpansion
                  ? t('medicalAppointments.expandReader')
                  : props.actionTitle
              }
              actionLabel={
                requiresExpansion
                  ? t('medicalAppointments.expandReader')
                  : cannotFitLine
                    ? t('medicalAppointments.readerTooSmall')
                    : props.actionLabel
              }
              onAction={requiresExpansion ? frame.expand : frame.execute}
              disabled={
                frame.closing ||
                (!requiresExpansion && (cannotFitLine || props.disabled))
              }
              supplementaryAction={props.supplementaryAction}
            />
          </View>
        </View>
      </View>
    </ClassificationReaderFrame>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0, justifyContent: 'center' },
  group: { width: '100%', gap: 12 },
  reader: { flex: 1, justifyContent: 'center' },
  viewport: { overflow: 'hidden' },
  text: { fontSize: 18, lineHeight: 26, textAlign: 'center' },
  measurement: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  footer: { gap: 8 },
});
