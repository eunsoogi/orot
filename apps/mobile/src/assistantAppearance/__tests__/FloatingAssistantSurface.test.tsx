import { useFloatingIdentityInset } from '../FloatingIdentityInset';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { FloatingAssistantSurface } from '../FloatingAssistantSurface';
import type { ConversationSession } from '../../ragConversation/conversationSessionTypes';
let mockReady = true;
jest.mock('../AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({ ready: mockReady }),
}));
jest.mock('../AssistantHeader', () => ({ AssistantHeader: () => null }));
jest.mock('../FloatingProfileGradient', () => ({
  FloatingProfileGradient: () => null,
}));
function Transcript() {
  const inset = useFloatingIdentityInset();
  return <View testID="transcript" style={{ paddingTop: inset }} />;
}
const session = { id: 1 } as ConversationSession;
test('measures only the floating group and leaves one independent transcript surface', async () => {
  await render(
    <FloatingAssistantSurface session={session}>
      <Transcript />
    </FloatingAssistantSurface>,
  );
  const overlay = screen.getByTestId('assistant-floating-overlay');
  expect(overlay).toHaveStyle({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  });
  expect(overlay.props.pointerEvents).toBe('box-none');
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 96 } },
  });
  expect(screen.getByTestId('transcript')).toHaveStyle({
    paddingTop: 96,
  });
  await fireEvent(overlay, 'layout', {
    nativeEvent: { layout: { height: 64 } },
  });
  expect(screen.getByTestId('transcript')).toHaveStyle({
    paddingTop: 64,
  });
});
test('does not reserve a blank floating area before saved preferences are ready', async () => {
  mockReady = false;
  await render(
    <FloatingAssistantSurface session={session}>
      <Text>History</Text>
    </FloatingAssistantSurface>,
  );
  expect(screen.queryByTestId('assistant-floating-overlay')).toBeNull();
  expect(screen.getByText('History')).toBeTruthy();
  mockReady = true;
});
