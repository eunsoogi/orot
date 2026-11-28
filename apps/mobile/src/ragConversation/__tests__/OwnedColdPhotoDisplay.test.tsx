import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationTranscriptMessages } from '../ConversationTranscriptMessages';
import { DirectPhotoPresentationScope } from '../DirectPhotoPresentationScope';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';
import {
  OwnedColdPhotoDisplayContext,
  useOwnedColdPhotoTranscript,
  type OwnedColdPhotoDisplay,
} from '../ownedColdPhotoDisplay';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const image =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAIABADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAcI/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCMtmAD/9k=';
const id = 'photo-reply:0123456789abcdef0123456789abcdef';
const createdAt = '2026-11-26T03:00:00.000Z';
const imageID = 'conversation-sent-photo-image';
const openerID = 'conversation-sent-photo-open';
const rows = savedHistoryTranscript(
  [
    {
      questionId: -1,
      answerId: -2,
      row: {
        kind: 'answer',
        id,
        createdAt,
        directPhoto: true,
        question: '',
        answer: 'Synthetic reply',
      },
    },
  ],
  [],
);

const captionRows = rows.map(row =>
  row.role === 'user' ? { ...row, content: 'Synthetic authored caption' } : row,
);
function Transcript({
  sessionId,
  caption = false,
}: {
  sessionId: number;
  caption?: boolean;
}) {
  const transcript = useOwnedColdPhotoTranscript(
    caption ? captionRows : rows,
    false,
    sessionId,
  );
  return (
    <ConversationTranscriptMessages
      messages={transcript}
      sessionId={sessionId}
      instructions={undefined}
      replyFocus={undefined}
      onLayout={jest.fn()}
      messageProps={{ onOpenSource: jest.fn(), onLinkError: jest.fn() }}
    />
  );
}
function draw(
  owner?: OwnedColdPhotoDisplay,
  sessionId = 1,
  caption = false,
  available = true,
) {
  return (
    <OwnedColdPhotoDisplayContext.Provider value={owner}>
      <DirectPhotoPresentationScope sessionId={sessionId} available={available}>
        <Transcript sessionId={sessionId} caption={caption} />
      </DirectPhotoPresentationScope>
    </OwnedColdPhotoDisplayContext.Provider>
  );
}
function fixture() {
  const stop = new AbortController();
  const generation = {};
  const accepted = { photoReplyId: id, generation, jpegs: [image] };
  const read = jest
    .fn<
      ReturnType<OwnedColdPhotoDisplay['read']>,
      Parameters<OwnedColdPhotoDisplay['read']>
    >()
    .mockResolvedValue(accepted);
  const owner: OwnedColdPhotoDisplay = {
    sessionId: 1,
    signal: stop.signal,
    generation,
    admits: candidate => candidate === id,
    current: () => true,
    read,
  };
  return { stop, read, owner, accepted };
}

test('stock saved photo bubble mounts and zooms only the exact owned cold JPEG; protection loss removes both', async () => {
  const f = fixture();
  const ui = await render(draw(f.owner));
  try {
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.read.mock.calls[0]?.[0]).toBe(id);
    expect(screen.getByTestId(imageID).props.source.uri).toBe(
      'data:image/jpeg;base64,' + image,
    );
    await fireEvent.press(screen.getByTestId(openerID));
    expect(
      screen.getByTestId('conversation-photo-viewer-image').props.source.uri,
    ).toBe('data:image/jpeg;base64,' + image);
    await act(async () => {
      f.stop.abort();
    });
    expect(screen.queryByTestId(imageID)).toBeNull();
    expect(screen.queryByTestId('conversation-photo-viewer-image')).toBeNull();
    expect(f.read.mock.calls[0]?.[1].aborted).toBe(true);
    expect(screen.getByText('Synthetic reply')).toBeVisible();
  } finally {
    await ui.unmount();
  }
});

test('a marker alone, nonmatching mounted session and explicit unavailable admission do not request pixels', async () => {
  const f = fixture();
  const ui = await render(draw());
  try {
    expect(screen.queryByTestId(imageID)).toBeNull();
    await ui.rerender(draw(f.owner, 2, true));
    expect(screen.getByText('Synthetic authored caption')).toBeVisible();
    await ui.rerender(draw({ ...f.owner, admits: () => false }));
    await ui.rerender(draw(f.owner, 1, false, false));
    expect(f.read).not.toHaveBeenCalled();
    expect(screen.queryByTestId(openerID)).toBeNull();
    expect(screen.getByText('Synthetic reply')).toBeVisible();
  } finally {
    await ui.unmount();
  }
});

test('null, wrong exact generation/request and non-JPEG results remain empty', async () => {
  const f = fixture();
  const ui = await render(draw());
  try {
    for (const result of [
      null,
      { ...f.accepted, generation: {} },
      { ...f.accepted, photoReplyId: id + 'miss' },
      { ...f.accepted, jpegs: ['file:///not-a-display-projection'] },
    ]) {
      f.read.mockResolvedValueOnce(result);
      await ui.rerender(draw({ ...f.owner }));
      expect(screen.queryByTestId(openerID)).toBeNull();
    }
    expect(f.read).toHaveBeenCalledTimes(4);
  } finally {
    await ui.unmount();
  }
});

test('a held result cannot reappear after session/owner replacement', async () => {
  const f = fixture();
  let finish: (() => void) | undefined;
  f.read.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = () => resolve(f.accepted);
      }),
  );
  const ui = await render(draw(f.owner));
  try {
    const abort = f.read.mock.calls[0]?.[1];
    await ui.rerender(draw(f.owner, 1, false, false));
    expect(abort?.aborted).toBe(true);
    await act(async () => {
      finish?.();
    });
    expect(screen.queryByTestId(openerID)).toBeNull();
    expect(screen.getByText('Synthetic reply')).toBeVisible();
  } finally {
    await ui.unmount();
  }
});

test.each(['current', 'admits'] as const)(
  'an unavailable synchronous %s proof retires the zoom and retains the caption',
  async predicate => {
    const f = fixture();
    let retired = false;
    const owner = {
      ...f.owner,
      [predicate]() {
        if (retired)
          throw new Error('Synthetic native authorizer unavailable.');
        return true;
      },
    };
    const ui = await render(draw(owner, 1, true));
    try {
      await fireEvent.press(screen.getByTestId(openerID));
      expect(
        screen.getByTestId('conversation-photo-viewer-image'),
      ).toBeVisible();
      retired = true;
      await ui.rerender(draw(owner, 1, true));
      expect(screen.queryByTestId(imageID)).toBeNull();
      expect(
        screen.queryByTestId('conversation-photo-viewer-image'),
      ).toBeNull();
      expect(screen.getByText('Synthetic authored caption')).toBeVisible();
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(f.read.mock.calls[0]?.[1].aborted).toBe(true);
    } finally {
      await ui.unmount();
    }
  },
);
