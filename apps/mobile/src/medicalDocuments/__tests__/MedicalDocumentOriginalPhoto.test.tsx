import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { MedicalDocumentOriginalPhoto } from '../MedicalDocumentOriginalPhoto';
import { isSavedMedicalDocumentPhoto } from '../medicalDocumentOriginalPhotoUtils';
import {
  MedicalDocumentImportError,
  medicalDocumentNativeBridge,
} from '../medicalDocumentNativeBridge';
import type {
  MedicalDocumentImportErrorCode,
  StoredMedicalDocumentPhoto,
} from '../medicalDocumentNativeBridge';

const sourceId = 'saved-photo-source';
const contentHash = 'sha256:stored-photo-hash';
const syntheticPhoto: StoredMedicalDocumentPhoto = {
  sourceId,
  mimeType: 'image/png',
  base64Data: 'c3ludGhldGlj',
};

const originalErrors: readonly {
  readonly code: MedicalDocumentImportErrorCode;
  readonly testID: string;
}[] = [
  {
    code: 'ORIGINAL_MISSING',
    testID: 'medical-document-source-original-missing',
  },
  {
    code: 'ORIGINAL_UNAVAILABLE',
    testID: 'medical-document-source-original-unavailable',
  },
  {
    code: 'UNSUPPORTED_ORIGINAL',
    testID: 'medical-document-source-original-unsupported',
  },
  {
    code: 'CORRUPT_ORIGINAL',
    testID: 'medical-document-source-original-corrupt',
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

/** Keeps the bridge identity and saved hash attached to the visible original. */
test('loads the saved original by source ID and exposes usable zoom controls', async () => {
  let resolveLoad: ((photo: StoredMedicalDocumentPhoto) => void) | undefined;
  const load = jest
    .spyOn(medicalDocumentNativeBridge, 'loadOriginalPhoto')
    .mockImplementation(
      () =>
        new Promise(resolve => {
          resolveLoad = resolve;
        }),
    );

  await render(
    <MedicalDocumentOriginalPhoto
      expectedContentHash={contentHash}
      sourceId={sourceId}
    />,
  );

  expect(
    screen.getByTestId('medical-document-source-original-loading'),
  ).toBeTruthy();
  await act(async () => resolveLoad?.(syntheticPhoto));
  const imageLoading = await screen.findByTestId(
    'medical-document-source-original-image-loading',
  );
  expect(imageLoading.props.source.uri).toBe(
    `data:${syntheticPhoto.mimeType};base64,${syntheticPhoto.base64Data}`,
  );
  expect(imageLoading.props.resizeMode).toBe('contain');
  expect(load).toHaveBeenCalledWith(sourceId, contentHash);

  await act(async () => {
    fireEvent(imageLoading, 'load');
  });
  expect(
    screen.getByTestId('medical-document-source-original-image'),
  ).toBeTruthy();
  expect(
    screen.getByTestId('medical-document-source-original-image').props
      .accessibilityLabel,
  ).toBe('저장된 원본 사진');
  expect(
    screen.getByTestId('medical-document-source-original-zoom-view').props
      .zoomScale,
  ).toBe(1);

  await fireEvent.press(
    screen.getByTestId('medical-document-source-original-zoom-in'),
  );
  expect(
    screen.getByTestId('medical-document-source-original-zoom-view').props
      .zoomScale,
  ).toBe(1.5);
  expect(
    screen.getByTestId('medical-document-source-original-zoom-reset').props
      .accessibilityValue,
  ).toEqual({ text: '150%' });
});

test.each(originalErrors)(
  'shows a retry path for $code and reloads the saved source',
  async ({ code, testID }) => {
    const load = jest
      .spyOn(medicalDocumentNativeBridge, 'loadOriginalPhoto')
      .mockRejectedValueOnce(new MedicalDocumentImportError(code))
      .mockResolvedValueOnce(syntheticPhoto);

    await render(
      <MedicalDocumentOriginalPhoto
        expectedContentHash={contentHash}
        sourceId={sourceId}
      />,
    );

    expect(await screen.findByTestId(testID)).toBeTruthy();
    await fireEvent.press(
      screen.getByTestId('medical-document-source-original-retry'),
    );
    expect(load).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByTestId(
        'medical-document-source-original-image-loading',
      ),
    ).toBeTruthy();
  },
);

test('reports an image decoding failure as corrupt and keeps a retry action', async () => {
  jest
    .spyOn(medicalDocumentNativeBridge, 'loadOriginalPhoto')
    .mockResolvedValue(syntheticPhoto);

  await render(
    <MedicalDocumentOriginalPhoto
      expectedContentHash={contentHash}
      sourceId={sourceId}
    />,
  );
  const imageLoading = await screen.findByTestId(
    'medical-document-source-original-image-loading',
  );
  await act(async () => fireEvent(imageLoading, 'error'));

  expect(
    screen.getByTestId('medical-document-source-original-corrupt'),
  ).toBeTruthy();
  expect(
    screen.getByTestId('medical-document-source-original-retry'),
  ).toBeTruthy();
});

test('rejects a bridge result for a different saved source as corrupt', async () => {
  jest
    .spyOn(medicalDocumentNativeBridge, 'loadOriginalPhoto')
    .mockResolvedValue({ ...syntheticPhoto, sourceId: 'different-source' });

  await render(
    <MedicalDocumentOriginalPhoto
      expectedContentHash={contentHash}
      sourceId={sourceId}
    />,
  );

  expect(
    await screen.findByTestId('medical-document-source-original-corrupt'),
  ).toBeTruthy();
});

test('clears a previously visible image before loading a different saved identity', async () => {
  const pendingLoads: Array<(photo: StoredMedicalDocumentPhoto) => void> = [];
  jest
    .spyOn(medicalDocumentNativeBridge, 'loadOriginalPhoto')
    .mockImplementation(
      () =>
        new Promise(resolve => {
          pendingLoads.push(resolve);
        }),
    );
  const firstPhoto = syntheticPhoto;
  const nextSourceId = 'next-saved-photo-source';
  const nextPhoto = { ...syntheticPhoto, sourceId: nextSourceId };
  const { rerender } = await render(
    <MedicalDocumentOriginalPhoto
      expectedContentHash={contentHash}
      sourceId={sourceId}
    />,
  );

  await act(async () => pendingLoads[0]?.(firstPhoto));
  const firstImage = await screen.findByTestId(
    'medical-document-source-original-image-loading',
  );
  await act(async () => fireEvent(firstImage, 'load'));
  expect(
    screen.getByTestId('medical-document-source-original-image'),
  ).toBeTruthy();

  await rerender(
    <MedicalDocumentOriginalPhoto
      expectedContentHash="sha256:next-saved-photo-hash"
      sourceId={nextSourceId}
    />,
  );
  expect(
    screen.getByTestId('medical-document-source-original-loading'),
  ).toBeTruthy();
  expect(
    screen.queryByTestId('medical-document-source-original-image'),
  ).toBeNull();

  await act(async () => pendingLoads[1]?.(nextPhoto));
  expect(
    await screen.findByTestId('medical-document-source-original-image-loading'),
  ).toBeTruthy();
});

test.each(['photo.jpg', 'photo.jpeg', 'photo.heic', 'photo.png'])(
  'recognizes saved photo title %s',
  title => {
    expect(isSavedMedicalDocumentPhoto(title)).toBe(true);
  },
);

test.each([undefined, null, 'record.pdf', 'record.txt'])(
  'keeps non-photo title %s out of the photo reader',
  title => {
    expect(isSavedMedicalDocumentPhoto(title)).toBe(false);
  },
);
