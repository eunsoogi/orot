import { act, render } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { createConversationSessions } from '../conversationSessions';
import {
  at,
  fixture,
  sessionId,
  Transcript,
} from '../testSupport/savedHistoryDisplayFixture';

test.each([false, true])(
  'emits only opted-in protected display milestones before mounted history (%s)',
  async enabled => {
    const f = await fixture(1);
    const previous = NativeModules.OrotProviderDiagnostics;
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { enabled, report };
    const store = createConversationSessions({
      retention: f.retention,
      restoreSession: f.strict,
      restoreSessionPage: f.strict,
      readSavedHistoryDisplay: f.reader,
    });
    const ui = await render(<Transcript store={store} />);
    try {
      await act(async () => {
        await store.attachExisting(sessionId, 0, at(0));
      });
      expect(ui.getByText('Synthetic saved answer 0')).toBeTruthy();
      expect(f.strict).not.toHaveBeenCalled();
      expect(f.forbidden).not.toHaveBeenCalled();
      expect(
        report.mock.calls.filter(
          ([, stage]) =>
            typeof stage === 'string' && stage.startsWith('history_display_'),
        ),
      ).toEqual(
        enabled
          ? [
              'history_display_admission',
              'history_display_open',
              'history_display_timeline',
              'history_display_presentation',
              'history_display_recheck',
            ].flatMap(stage => [
              ['rag', stage, 'started'],
              ['rag', stage, 'completed'],
            ])
          : [],
      );
    } finally {
      await ui.unmount();
      store.dispose();
      f.f.close();
      NativeModules.OrotProviderDiagnostics = previous;
    }
  },
);
