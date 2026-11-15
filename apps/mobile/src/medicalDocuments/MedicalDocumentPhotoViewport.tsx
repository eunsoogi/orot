import { useCallback, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { t } from '../i18n';
import { ZoomButton } from './MedicalDocumentOriginalPhotoControls';
import { medicalDocumentOriginalPhotoStyles as styles } from './MedicalDocumentOriginalPhotoLayout';

const maximumZoomScale = 4;

/** Shares bounded zoom and rotation reset between the card and its in-memory full-screen view. */
export function MedicalDocumentPhotoViewport({
  photoURI,
  imageReady,
  onLoad,
  onError,
  onOpen,
  fullScreen = false,
}: {
  readonly photoURI: string;
  readonly imageReady: boolean;
  readonly onLoad: () => void;
  readonly onError: () => void;
  readonly onOpen?: () => void;
  readonly fullScreen?: boolean;
}) {
  const [zoomScale, setZoomScale] = useState(1);
  const [viewportRevision, setViewportRevision] = useState(0);
  const previousViewport = useRef<{ width: number; height: number } | null>(
    null,
  );
  const changeZoom = useCallback((next: number) => {
    const bounded = Math.max(1, Math.min(maximumZoomScale, next));
    setZoomScale(bounded);
  }, []);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const observed = event.nativeEvent.zoomScale;
      if (typeof observed === 'number' && Number.isFinite(observed)) {
        setZoomScale(current =>
          Math.abs(current - observed) > 0.04 ? observed : current,
        );
      }
    },
    [],
  );

  const handleViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    const previous = previousViewport.current;
    previousViewport.current = { width, height };
    if (
      previous &&
      (Math.abs(previous.width - width) > 0.5 ||
        Math.abs(previous.height - height) > 0.5)
    ) {
      // Reset native zoom after reflow so a resized viewport cannot strand the image off-screen.
      setZoomScale(1);
      setViewportRevision(value => value + 1);
    }
  }, []);

  return (
    <>
      <View
        onLayout={handleViewportLayout}
        style={fullScreen ? styles.fullScreenViewport : styles.viewport}
      >
        <ScrollView
          bouncesZoom
          centerContent
          contentContainerStyle={styles.zoomContent}
          key={viewportRevision}
          maximumZoomScale={maximumZoomScale}
          minimumZoomScale={1}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={styles.zoomView}
          testID="medical-document-source-original-zoom-view"
          zoomScale={zoomScale}
        >
          <Pressable
            accessible={false}
            onPress={onOpen}
            style={styles.image}
            testID="medical-document-photo-open-fullscreen"
          >
            <Image
              accessibilityActions={
                onOpen
                  ? [
                      {
                        name: 'activate',
                        label: t(
                          'medicalDocument.source.original.openFullScreen',
                        ),
                      },
                    ]
                  : undefined
              }
              onAccessibilityAction={onOpen ? () => onOpen() : undefined}
              accessible={imageReady}
              accessibilityLabel={
                imageReady
                  ? t('medicalDocument.source.original.accessibilityLabel')
                  : undefined
              }
              accessibilityRole="image"
              onError={onError}
              onLoad={onLoad}
              resizeMode="contain"
              source={{ uri: photoURI }}
              style={styles.image}
              testID={
                imageReady
                  ? 'medical-document-source-original-image'
                  : 'medical-document-source-original-image-loading'
              }
            />
          </Pressable>
        </ScrollView>
      </View>
      <View style={styles.zoomControls}>
        <ZoomButton
          disabled={!imageReady || zoomScale <= 1.04}
          label={t('medicalDocument.source.original.zoomOut')}
          onPress={() => changeZoom(zoomScale / 1.5)}
          testID="medical-document-source-original-zoom-out"
          visibleLabel="−"
        />
        <ZoomButton
          disabled={!imageReady || zoomScale <= 1.04}
          label={t('medicalDocument.source.original.zoomReset')}
          onPress={() => changeZoom(1)}
          testID="medical-document-source-original-zoom-reset"
          accessibilityValue={`${Math.round(zoomScale * 100)}%`}
          visibleLabel="1:1"
        />
        <ZoomButton
          disabled={!imageReady || zoomScale >= maximumZoomScale - 0.04}
          label={t('medicalDocument.source.original.zoomIn')}
          onPress={() => changeZoom(zoomScale * 1.5)}
          testID="medical-document-source-original-zoom-in"
          visibleLabel="+"
        />
      </View>
    </>
  );
}
