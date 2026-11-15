import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { MedicalDocumentPhotoViewport } from './MedicalDocumentPhotoViewport';
import { MedicalDocumentPhotoFullScreen } from './MedicalDocumentPhotoFullScreen';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { medicalDocumentNativeBridge } from './medicalDocumentNativeBridge';
import {
  PhotoError,
  photoErrorState,
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
  const [fullScreen, setFullScreen] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);

  useEffect(() => {
    let current = true;
    setFullScreen(false);
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
          <MedicalDocumentPhotoViewport
            photoURI={photoURI}
            imageReady={imageReady}
            onOpen={imageReady ? () => setFullScreen(true) : undefined}
            onError={() => {
              setFullScreen(false);
              setPhoto({ status: 'corrupt' });
            }}
            onLoad={() =>
              setPhoto(current =>
                current.status === 'imageLoading'
                  ? { status: 'ready', uri: current.uri }
                  : current,
              )
            }
          />
          {fullScreen && imageReady ? (
            <MedicalDocumentPhotoFullScreen
              photoURI={photoURI}
              onClose={() => setFullScreen(false)}
              onError={() => {
                setFullScreen(false);
                setPhoto({ status: 'corrupt' });
              }}
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}
