import { fireEvent, render, screen } from '@testing-library/react-native';
import { directPhotoComposerFixture } from '../testSupport/directPhotoComposerFixture';
import { conversationDirectPhotoPorts as ports } from '../conversationDirectPhotoPorts';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('../conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));

test('a selected draft opens full-screen without sending and closes back to its thumbnail', async () => {
  const f = await directPhotoComposerFixture();
  try {
    await render(f.view);
    await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
    const thumbnail = screen.getByTestId('conversation-photo-preview');
    const open = () =>
      fireEvent.press(
        screen.getByRole('button', { name: '첨부 사진 전체 화면으로 보기' }),
      );
    await open();
    const viewer = screen.getByTestId('conversation-photo-viewer');
    expect(viewer.props.presentationStyle).toBe('fullScreen');
    const image = screen.getByTestId('conversation-photo-viewer-image');
    expect(image.props.source).toEqual(thumbnail.props.source);
    expect(image.props.resizeMode).toBe('contain');
    const zoom = screen.getByTestId('conversation-photo-viewer-zoom');
    expect(zoom.props.maximumZoomScale).toBe(4);
    expect(zoom.props.automaticallyAdjustContentInsets).toBe(false);
    expect(zoom.props.contentInsetAdjustmentBehavior).toBe('never');
    const controls = screen.getByTestId('conversation-photo-viewer-controls');
    expect(controls.props.pointerEvents).toBe('box-none');
    expect(controls.props.style).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
    });
    expect(ports.grant).not.toHaveBeenCalled();
    expect(f.start).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: '사진 닫기' }));
    expect(screen.queryByTestId('conversation-photo-viewer')).toBeNull();
    expect(screen.getByTestId('conversation-photo-preview')).toBeTruthy();
    await open();
    await fireEvent(
      screen.getByTestId('conversation-photo-viewer'),
      'requestClose',
    );
    expect(screen.queryByTestId('conversation-photo-viewer')).toBeNull();
  } finally {
    f.close();
  }
});
