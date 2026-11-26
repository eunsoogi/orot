import { fireEvent, render, screen } from '@testing-library/react-native';
import { t } from '../../i18n';
import { ConversationMessage } from '../ConversationMessage';
import type { DisplayMessage } from '../conversationDisplayMessage';
import { projectTranscript } from '../conversationBubblePaint';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';
import { presentDirectPhotos } from '../directPhotoPresentation';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('an owned outgoing photo can zoom; retired or restored markers never open images', async () => {
  const message: DisplayMessage = {
    id: 1,
    role: 'user',
    content: '',
    photoAttached: true,
  };
  const uri = 'data:image/jpeg;base64,c3ludGhldGlj';
  const row = (previewURI?: string) => (
    <ConversationMessage
      message={{ ...message, directPhotoPreviewData: previewURI }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />
  );
  const view = await render(row(uri));
  expect(
    screen.getByTestId('conversation-sent-photo-image').props.source,
  ).toEqual({ uri });
  expect(screen.queryByText(t('ragConversation.photo.message'))).toBeNull();
  const open = () =>
    fireEvent.press(screen.getByTestId('conversation-sent-photo-open'));
  await open();
  expect(
    screen.getByTestId('conversation-photo-viewer-image').props.source,
  ).toEqual({ uri });
  expect(
    screen.getByTestId('conversation-photo-viewer-zoom').props.maximumZoomScale,
  ).toBe(4);
  await fireEvent.press(screen.getByRole('button', { name: '사진 닫기' }));
  expect(screen.queryByTestId('conversation-photo-viewer')).toBeNull();
  await open();
  await view.rerender(row());
  expect(screen.queryByTestId('conversation-photo-viewer')).toBeNull();
  expect(screen.queryByTestId('conversation-sent-photo-open')).toBeNull();
  expect(screen.queryByText(t('ragConversation.photo.message'))).toBeNull();
  expect(screen.queryByTestId('conversation-user-message')).toBeNull();
});

test('the rounded attachment precedes the separate authored text bubble', async () => {
  const uri = 'data:image/jpeg;base64,c3ludGhldGlj';
  const text = '이 사진 설명해 줘.';
  const ui = await render(
    <ConversationMessage
      message={{
        id: 1,
        role: 'user',
        content: text,
        photoAttached: true,
        directPhotoPreviewData: uri,
      }}
      onOpenSource={jest.fn()}
      onLinkError={jest.fn()}
    />,
  );
  try {
    const image = screen.getByTestId('conversation-sent-photo-image');
    expect(image).toHaveStyle({ borderRadius: 12 });
    const attachment = screen.getByTestId('conversation-sent-photo-open');
    const bubble = screen.getByTestId('conversation-user-message');
    expect(attachment.parent).toBe(bubble.parent);
    expect(
      attachment.parent?.children.map(child =>
        typeof child === 'string' ? child : child.props.testID,
      ),
    ).toEqual(['conversation-sent-photo-open', 'conversation-user-message']);
    expect(screen.getByText(text)).toBeVisible();
    expect(screen.queryByText(t('ragConversation.photo.message'))).toBeNull();
  } finally {
    await ui.unmount();
  }
});

test('an exact already-owned preview can join a saved photo reply but never another session or old marker', async () => {
  const uri = 'data:image/jpeg;base64,c3ludGhldGlj';
  const createdAt = '2026-11-26T03:00:00.000Z';
  const id = 'photo-reply:0123456789abcdef0123456789abcdef';
  const stored = savedHistoryTranscript(
    [
      {
        questionId: -1,
        answerId: -2,
        row: {
          id,
          createdAt,
          kind: 'answer',
          directPhoto: true,
          question: '',
          answer: '합성 답변',
        },
      },
    ],
    [],
  );
  const preview = {
    sessionId: 1,
    requestId: id,
    displayId: 9,
    submittedAt: createdAt,
    prompt: '',
    preview: uri,
    pending: false,
  };
  const draw = (sessionId: number, hasImage: boolean, requestId = id) => (
    <>
      {projectTranscript(
        presentDirectPhotos(
          stored,
          hasImage ? [{ ...preview, requestId }] : [],
          sessionId,
        ),
        false,
      ).map(message => (
        <ConversationMessage
          key={message.id}
          message={message}
          onOpenSource={jest.fn()}
          onLinkError={jest.fn()}
        />
      ))}
    </>
  );
  const ui = await render(draw(1, true));
  try {
    expect(screen.getAllByTestId('conversation-sent-photo-image')).toHaveLength(
      1,
    );
    expect(screen.queryByTestId('conversation-user-message')).toBeNull();
    expect(screen.queryByText(t('ragConversation.photo.message'))).toBeNull();
    await ui.rerender(draw(2, true));
    expect(screen.queryByTestId('conversation-sent-photo-image')).toBeNull();
    await ui.rerender(draw(1, true, 'another-owner'));
    expect(screen.queryByTestId('conversation-sent-photo-image')).toBeNull();
    await ui.rerender(draw(1, false));
    expect(screen.queryByTestId('conversation-sent-photo-image')).toBeNull();
    expect(screen.queryByText(t('ragConversation.photo.message'))).toBeNull();
    expect(screen.getByText('합성 답변')).toBeVisible();
  } finally {
    await ui.unmount();
  }
});
