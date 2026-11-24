import { useState } from 'react';
import {
  AppState,
  Dimensions,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type AppStateStatus,
} from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationWorkspace } from '../ConversationWorkspace';
import { ConversationHistory } from '../ConversationHistory';
import type { ConversationSession } from '../conversationSessionTypes';

jest.mock('../../navigation/NavigationGeometryProvider', () => ({
  useNavigationGeometry: () => null,
}));
jest.mock('../../assistantAppearance/FloatingProfileGradient', () => ({
  FloatingProfileGradient: () => null,
}));

type Measurement = (x: number, y: number, w: number, h: number) => void;
const nativeView = View as unknown as {
  prototype: {
    measureInWindow(callback: Measurement): void;
  };
};
const session: ConversationSession = {
  id: 1,
  title: 'Synthetic conversation',
  createdAt: '2026-11-24T00:00:00Z',
  draft: '',
  busy: false,
  error: '',
  pendingMessage: null,
  messages: [
    { id: 1, role: 'assistant', content: 'Same mounted synthetic answer' },
  ],
};
const actions = { onOpenSource: jest.fn(), onLinkError: jest.fn() };

function Fixture() {
  const [draft, update] = useState('');
  return (
    <ConversationWorkspace
      session={session}
      sourceActions={actions}
      composer={
        <TextInput
          testID="synthetic-draft"
          value={draft}
          onChangeText={update}
        />
      }
    >
      <ConversationHistory
        {...actions}
        messages={session.messages}
        pendingMessage={null}
        error=""
      />
    </ConversationWorkspace>
  );
}

test('bounds an existing transcript during compact resize and preserves its reading host through rapid reflow and foreground return', async () => {
  const original = Dimensions.get('window');
  const originalPhase = Object.getOwnPropertyDescriptor(
    AppState,
    'currentState',
  )!;
  const pending: Measurement[] = [];
  const listeners = new Set<(phase: AppStateStatus) => void>();
  let measureNow = true;
  const measure = jest
    .spyOn(nativeView.prototype, 'measureInWindow')
    .mockImplementation(callback => {
      if (measureNow) callback(0, 0, 842, 540);
      else pending.push(callback);
    });
  const subscribe = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((type, listener) => {
      if (type === 'change') listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const scrollToEnd = jest.spyOn(ScrollView.prototype, 'scrollToEnd');
  const resize = (width: number, height: number) =>
    act(() => {
      Dimensions.set({ window: { ...original, width, height } });
    });
  const phase = (value: AppStateStatus) =>
    act(() => {
      Object.defineProperty(AppState, 'currentState', {
        value,
        configurable: true,
      });
      listeners.forEach(listener => listener(value));
    });
  const width = () =>
    StyleSheet.flatten(
      screen.getByTestId('conversation-transcript-pane').props.style,
    ).width;
  try {
    await phase('active');
    await resize(842, 540);
    await render(<Fixture />);
    expect(width()).toBe(842);
    const row = screen.getByTestId('conversation-message-body');
    const input = screen.getByTestId('synthetic-draft');
    const transcript = screen.getByTestId('rag-conversation-history');
    await fireEvent.changeText(input, 'kept draft');
    await fireEvent(transcript, 'scrollBeginDrag');
    await fireEvent.scroll(transcript, {
      nativeEvent: {
        contentOffset: { x: 0, y: 160 },
        contentSize: { width: 842, height: 1200 },
        layoutMeasurement: { width: 842, height: 420 },
      },
    });
    await fireEvent(transcript, 'scrollEndDrag');
    scrollTo.mockClear();
    scrollToEnd.mockClear();

    // New dimensions arrive before a positive callback for the reflowed host.
    measureNow = false;
    await resize(390, 812);
    expect(pending).not.toHaveLength(0);
    expect(width()).toBe(390);
    // A pending callback sampling the still-wide native host is not authoritative.
    await act(() => pending.at(-1)!(0, 0, 842, 540));
    expect(width()).toBe(390);
    await fireEvent(
      screen.getByTestId('conversation-workspace-host'),
      'layout',
      {
        nativeEvent: { layout: { x: 0, y: 0, width: 372, height: 790 } },
      },
    );
    await act(() => pending.at(-1)!(0, 0, 372, 790));
    expect(width()).toBe(372);

    await resize(710, 680);
    const staleWide = pending.at(-1)!;
    await resize(345, 812);
    expect(width()).toBe(345);
    await phase('background');
    await phase('active');
    await act(() => pending.at(-1)!(0, 0, 330, 800));
    await act(() => staleWide(0, 0, 710, 680));
    expect(width()).toBe(330);
    // The original reader and editor still own the same native instances.
    await fireEvent(transcript, 'layout', {
      nativeEvent: { layout: { width: 330, height: 390 } },
    });
    await fireEvent(transcript, 'contentSizeChange', 330, 1200);
    expect(screen.getByTestId('conversation-message-body')).toBe(row);
    expect(screen.getByText('Same mounted synthetic answer')).toBeTruthy();
    expect(screen.getByTestId('rag-conversation-history')).toBe(transcript);
    expect(screen.getByTestId('synthetic-draft')).toBe(input);
    expect(input.props.value).toBe('kept draft');
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollToEnd).not.toHaveBeenCalled();
  } finally {
    await act(() => {
      Dimensions.set({ window: original });
      Object.defineProperty(AppState, 'currentState', originalPhase);
    });
    measure.mockRestore();
    subscribe.mockRestore();
    scrollTo.mockRestore();
    scrollToEnd.mockRestore();
  }
});
