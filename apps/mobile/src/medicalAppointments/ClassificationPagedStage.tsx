import {
  ClassificationConfirmationCaption,
  type ClassificationCaptionCopy,
} from './ClassificationConfirmationCaption';
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
  ClassificationCircleButton,
  ClassificationCircleSlot,
  classificationConfirmationGeometry,
} from './ClassificationCircle';
import { useClassificationExpandedDuo } from './classificationExpandedDuo';
import {
  paginateClassificationLines,
  type ClassificationTextLine,
} from './classificationTextPagination';
interface Props {
  readonly documents: readonly string[];
  readonly caption?: ClassificationCaptionCopy;
  readonly actionTitle: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly disabled?: boolean;
  readonly testID: string;
  readonly confirmAtDock?: boolean;
  readonly supplementaryAction?: {
    readonly title: string;
    readonly onPress: () => void;
  };
}
export function ClassificationPagedStage(props: Props) {
  const window = useWindowDimensions();
  const expandedDuo = useClassificationExpandedDuo(window);
  const scale = window.fontScale;
  const frame = useClassificationReaderFrame(props.onAction, props.documents);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [footerHeight, setFooterHeight] = useState(0);
  const [documentIndex, setDocumentIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const lastDocument = Math.max(0, props.documents.length - 1);
  const index = Math.min(documentIndex, lastDocument);
  const text = props.documents[index] ?? '';
  const identity = JSON.stringify([text, bounds.width, scale]);
  const latestIdentity = useRef(identity);
  latestIdentity.current = identity;
  const [measurement, setMeasurement] = useState<{
    key: string;
    lines: readonly ClassificationTextLine[];
  } | null>(null);
  const { width, height } = bounds.height ? bounds : window;
  const geometry = classificationConfirmationGeometry(
    width,
    height,
    scale,
    Boolean(props.confirmAtDock && !frame.expanded),
    Boolean(bounds.width && bounds.height && expandedDuo),
  );
  const { captionTop: top, listStart: left, bottomInset: bottom } = geometry;
  const available = Math.max(0, height - top - bottom - footerHeight);
  const [captionMeasurement, setCaptionMeasurement] = useState<{
    key: string;
    height: number;
  }>();
  const captionHeight =
    captionMeasurement?.key === identity ? captionMeasurement.height : 0;
  const captionFits =
    !!props.caption && captionHeight > 0 && captionHeight <= available;
  const lines = measurement?.key === identity ? measurement.lines : null;
  const measuredPages =
    lines && available > 0 ? paginateClassificationLines(lines, available) : [];
  const pages = measuredPages.length ? measuredPages : [text];
  const page = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const cannotFitLine =
    !captionFits && !!lines?.some(line => line.height > available);
  const requiresExpansion = cannotFitLine && !frame.expanded;
  const naturalHeight =
    lines?.reduce((sum, line) => sum + line.height, 0) ?? available;
  const viewportHeight = captionFits
    ? captionHeight
    : cannotFitLine
      ? 0
      : Math.min(available, naturalHeight);
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
          const layout = event.nativeEvent.layout;
          setBounds(old =>
            old.width === layout.width && old.height === layout.height
              ? old
              : { width: layout.width, height: layout.height },
          );
        }}
      >
        <ClassificationCircleSlot {...geometry} paneWidth={width}>
          <ClassificationCircleButton
            size={geometry.size}
            title={
              requiresExpansion
                ? t('medicalAppointments.readerShort')
                : props.actionTitle
            }
            label={
              requiresExpansion
                ? t('medicalAppointments.expandReader')
                : cannotFitLine
                  ? t('medicalAppointments.readerTooSmall')
                  : props.actionLabel
            }
            onPress={requiresExpansion ? frame.expand : frame.execute}
            disabled={
              frame.closing ||
              (!requiresExpansion && (cannotFitLine || Boolean(props.disabled)))
            }
          />
        </ClassificationCircleSlot>
        <View
          style={[styles.group, { top, left, bottom }]}
          testID="classification-stage-captions"
        >
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
            {props.caption ? (
              <ClassificationConfirmationCaption
                key={`caption-${identity}`}
                copy={props.caption}
                measuring
                onLayout={event => {
                  if (latestIdentity.current === identity)
                    setCaptionMeasurement({
                      key: identity,
                      height: event.nativeEvent.layout.height,
                    });
                }}
              />
            ) : null}
            {captionFits && props.caption ? (
              <ClassificationConfirmationCaption copy={props.caption} />
            ) : !cannotFitLine ? (
              <View style={styles.reader}>
                <Text
                  style={styles.text}
                  testID="classification-page-text"
                  accessibilityLiveRegion="polite"
                  accessibilityHint={t('medicalAppointments.resultPosition', {
                    current: page + 1,
                    total: pages.length,
                  })}
                  numberOfLines={
                    measuredPages.length
                      ? undefined
                      : Math.max(1, Math.floor(available / (26 * scale)))
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
              showPaging={
                !captionFits && (pages.length > 1 || props.documents.length > 1)
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
  fill: { flex: 1, width: '100%', minHeight: 0 },
  group: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  reader: { flex: 1, justifyContent: 'center' },
  viewport: { overflow: 'hidden' },
  text: { fontSize: 18, lineHeight: 26, textAlign: 'center' },
  measurement: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  footer: { gap: 8 },
});
