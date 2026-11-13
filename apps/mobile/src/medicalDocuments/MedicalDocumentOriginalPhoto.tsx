import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, View } from 'react-native';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { medicalDocumentNativeBridge } from './medicalDocumentNativeBridge';
import {
  PhotoError,
  photoErrorState,
  ZoomButton,
} from './MedicalDocumentOriginalPhotoControls';
import type { PhotoErrorStatus } from './MedicalDocumentOriginalPhotoControls';
import { medicalDocumentOriginalPhotoStyles as styles } from './MedicalDocumentOriginalPhotoLayout';

interface MedicalDocumentOriginalPhotoProps {
  readonly sourceId: string;
  readonly expectedContentHash: string | null;
}

type PhotoState =
  | { readonly status: 'loading' }
  | { readonly status: 'imageLoading'; readonly uri: string }
  | { readonly status: 'ready'; readonly uri: string }
  | { readonly status: PhotoErrorStatus };

const maximumZoomScale = 4;

/** Restarts viewer state when saved identity or hash changes, so old document pixels cannot linger. */
export function MedicalDocumentOriginalPhoto({
  sourceId,
  expectedContentHash,
}: MedicalDocumentOriginalPhotoProps) {
  const identity = JSON.stringify([sourceId, expectedContentHash]);
  return (
    <MedicalDocumentOriginalPhotoContent
      expectedContentHash={expectedContentHash}
      key={identity}
      sourceId={sourceId}
    />
  );
}

/** Loads the hash-verified original while keeping the image separate from OCR evidence. */
function MedicalDocumentOriginalPhotoContent({
  sourceId,
  expectedContentHash,
}: MedicalDocumentOriginalPhotoProps) {
  const [photo, setPhoto] = useState<PhotoState>({ status: 'loading' });
  const [zoomScale, setZoomScale] = useState(1);
  const [viewportRevision, setViewportRevision] = useState(0);
  const [retryRevision, setRetryRevision] = useState(0);
  const previousViewport = useRef<{ width: number; height: number } | null>(
    null,
  );

  useEffect(() => {
    let current = true;
    setZoomScale(1);
    setPhoto({ status: 'loading' });

    medicalDocumentNativeBridge
      .loadOriginalPhoto(sourceId, expectedContentHash)
      .then(result => {
        if (!current) return;
        if (result.sourceId !== sourceId) {
          setPhoto({ status: 'corrupt' });
          return;
        }
        setPhoto({
          status: 'imageLoading',
          uri: `data:${result.mimeType};base64,${result.base64Data}`,
        });
      })
      .catch(error => {
        if (current) setPhoto({ status: photoErrorState(error) });
      });

    return () => {
      current = false;
    };
  }, [expectedContentHash, retryRevision, sourceId]);

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

  const imageReady = photo.status === 'ready';
  const photoURI =
    photo.status === 'ready' || photo.status === 'imageLoading'
      ? photo.uri
      : null;
  return (
    <View style={styles.panel} testID="medical-document-source-original-photo">
      <Text accessibilityRole="header" style={styles.title}>
        {t('medicalDocument.source.original.title')}
      </Text>
      {photo.status === 'loading' || photo.status === 'imageLoading' ? (
        <View
          accessibilityLiveRegion="polite"
          style={styles.status}
          testID="medical-document-source-original-loading"
        >
          <ActivityIndicator color={appColors.primary} />
          <Text style={styles.statusText}>
            {t('medicalDocument.source.original.loading')}
          </Text>
        </View>
      ) : null}
      {photo.status === 'missing' ? (
        <PhotoError
          message={t('medicalDocument.source.original.missing')}
          onRetry={() => setRetryRevision(value => value + 1)}
          testID="medical-document-source-original-missing"
        />
      ) : null}
      {photo.status === 'unavailable' ? (
        <PhotoError
          message={t('medicalDocument.source.original.unavailable')}
          onRetry={() => setRetryRevision(value => value + 1)}
          testID="medical-document-source-original-unavailable"
        />
      ) : null}
      {photo.status === 'unsupported' ? (
        <PhotoError
          message={t('medicalDocument.source.original.unsupported')}
          onRetry={() => setRetryRevision(value => value + 1)}
          testID="medical-document-source-original-unsupported"
        />
      ) : null}
      {photo.status === 'corrupt' ? (
        <PhotoError
          message={t('medicalDocument.source.original.corrupt')}
          onRetry={() => setRetryRevision(value => value + 1)}
          testID="medical-document-source-original-corrupt"
        />
      ) : null}
      {photoURI ? (
        <>
          <View onLayout={handleViewportLayout} style={styles.viewport}>
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
              <Image
                accessible={imageReady}
                accessibilityLabel={
                  imageReady
                    ? t('medicalDocument.source.original.accessibilityLabel')
                    : undefined
                }
                accessibilityRole="image"
                onError={() => setPhoto({ status: 'corrupt' })}
                onLoad={() =>
                  setPhoto(current =>
                    current.status === 'imageLoading'
                      ? { status: 'ready', uri: current.uri }
                      : current,
                  )
                }
                resizeMode="contain"
                source={{ uri: photoURI }}
                style={styles.image}
                testID={
                  imageReady
                    ? 'medical-document-source-original-image'
                    : 'medical-document-source-original-image-loading'
                }
              />
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
      ) : null}
    </View>
  );
}
