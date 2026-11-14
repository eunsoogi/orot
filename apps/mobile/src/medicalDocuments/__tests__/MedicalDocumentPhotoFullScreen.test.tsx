import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { MedicalDocumentOriginalPhoto } from '../MedicalDocumentOriginalPhoto';
import { medicalDocumentNativeBridge } from '../medicalDocumentNativeBridge';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const photo = {
  sourceId: 'synthetic-source',
  mimeType: 'image/png' as const,
  base64Data: 'c3ludGhldGlj',
};

beforeEach(() =>
  jest
    .spyOn(medicalDocumentNativeBridge, 'loadOriginalPhoto')
    .mockResolvedValue(photo),
);
afterEach(() => jest.restoreAllMocks());

async function openPhoto() {
  await act(async () =>
    fireEvent(
      screen.getByTestId('medical-document-source-original-image-loading'),
      'load',
    ),
  );
  await fireEvent.press(
    screen.getByTestId('medical-document-photo-open-fullscreen'),
  );
  return screen.getByTestId('medical-document-photo-fullscreen');
}

/** Component contracts prove state and callbacks, not UIKit geometry or actual image decoding. */
test('opens verified pixels full-screen and closes repeatedly without reimporting', async () => {
  await render(
    <MedicalDocumentOriginalPhoto
      sourceId={photo.sourceId}
      expectedContentHash="hash"
    />,
  );
  expect(screen.queryByTestId('medical-document-photo-fullscreen')).toBeNull();
  let modal = await openPhoto();
  expect(modal.props.presentationStyle).toBe('fullScreen');
  expect(modal.props.supportedOrientations).toContain('landscape-left');
  const viewer = within(modal);
  expect(
    viewer.getByTestId('medical-document-source-original-image').props.source
      .uri,
  ).toBe('data:image/png;base64,c3ludGhldGlj');
  await fireEvent.press(
    viewer.getByTestId('medical-document-source-original-zoom-in'),
  );
  expect(
    viewer.getByTestId('medical-document-source-original-zoom-view').props
      .zoomScale,
  ).toBe(1.5);
  await fireEvent.press(
    viewer.getByTestId('medical-document-photo-fullscreen-close'),
  );
  expect(screen.queryByTestId('medical-document-photo-fullscreen')).toBeNull();
  await fireEvent.press(
    screen.getByTestId('medical-document-photo-open-fullscreen'),
  );
  modal = screen.getByTestId('medical-document-photo-fullscreen');
  expect(
    within(modal).getByTestId('medical-document-source-original-zoom-view')
      .props.zoomScale,
  ).toBe(1);
  await fireEvent(modal, 'requestClose');
  expect(screen.queryByTestId('medical-document-photo-fullscreen')).toBeNull();
  expect(medicalDocumentNativeBridge.loadOriginalPhoto).toHaveBeenCalledTimes(
    1,
  );
});

test('identity change dismisses modal before resolving another source', async () => {
  const { rerender } = await render(
    <MedicalDocumentOriginalPhoto
      sourceId={photo.sourceId}
      expectedContentHash="hash"
    />,
  );
  await openPhoto();
  jest
    .mocked(medicalDocumentNativeBridge.loadOriginalPhoto)
    .mockImplementation(() => new Promise(() => {}));
  await rerender(
    <MedicalDocumentOriginalPhoto
      sourceId="another-source"
      expectedContentHash="another-hash"
    />,
  );
  expect(screen.queryByTestId('medical-document-photo-fullscreen')).toBeNull();
  expect(
    screen.queryByTestId('medical-document-source-original-image'),
  ).toBeNull();
});

test('modal decode failure closes it and shows the existing recoverable error', async () => {
  await render(
    <MedicalDocumentOriginalPhoto
      sourceId={photo.sourceId}
      expectedContentHash="hash"
    />,
  );
  const modal = await openPhoto();
  await fireEvent(
    within(modal).getByTestId('medical-document-source-original-image'),
    'error',
  );
  expect(screen.queryByTestId('medical-document-photo-fullscreen')).toBeNull();
  expect(
    screen.getByTestId('medical-document-source-original-corrupt'),
  ).toBeTruthy();
});
