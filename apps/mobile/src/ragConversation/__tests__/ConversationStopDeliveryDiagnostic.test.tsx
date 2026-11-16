import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationGlassAction } from '../ConversationGlassAction';
import { providerDiagnostic } from '../../providers/diagnostics';

jest.mock('../../providers/diagnostics', () => ({
  providerDiagnostic: jest.fn(),
}));

// This proves the JS bridge callback boundary, not physical UIKit tap delivery latency.
test.each([true, false])(
  'only a Stop callback records a fixed delivery token: busy=%s',
  async busy => {
    const diagnostic = jest.mocked(providerDiagnostic);
    diagnostic.mockReset();
    const onPress = jest.fn(() => {
      expect(diagnostic.mock.calls).toEqual(
        busy ? [['rag', 'stop_js', 'started']] : [],
      );
    });
    await render(
      <ConversationGlassAction
        busy={busy}
        disabled={false}
        label="SYNTHETIC_PRIVATE"
        onPress={onPress}
      />,
    );
    await fireEvent(
      screen.getByTestId(
        busy ? 'rag-conversation-cancel' : 'rag-conversation-send',
      ),
      'composerPress',
    );
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
      'SYNTHETIC_PRIVATE',
    );
  },
);
