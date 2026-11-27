import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useSyncExternalStore } from 'react';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createCredentialMutationOwner } from '../../agent/execution/credentialMutation';
import { createDailyReportService } from '../../aiFeatures/integration/dailyReportService';
import { conversationIntentRequests } from '../../aiFeatures/integration/conversationIntent';
import { calendarFixture } from '../../aiFeatures/integration/testSupport/dailyReportCalendarTestFixture';
import {
  prepareReportDatabase,
  reportProvider,
  reportRequest,
  selectedReportProvider,
} from '../../aiFeatures/integration/testSupport/dailyReportFailureStageFixtures';
import { ConversationHistory } from '../ConversationHistory';
import { createConversationSessions } from '../conversationSessions';

function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}

test.each(['current', 'replaced', 'stopped'] as const)(
  'only real Daily Report provider start changes the mounted shortcut receipt: %s',
  async mode => {
    const f = openSqliteTestDatabase(':memory:');
    const sessions = createConversationSessions();
    const heldCalendar = gate();
    const heldSelection = gate();
    const heldResponse = gate();
    const calendar = calendarFixture();
    const selectionOwner = createCredentialMutationOwner();
    let providerStart: (() => void) | undefined;
    const activeProvider = reportProvider();
    const generate = activeProvider.generate.bind(activeProvider);
    const dispatch = jest
      .spyOn(activeProvider, 'generate')
      .mockImplementation(async (request, options) => {
        providerStart = options?.onResponseStarted;
        await heldResponse.wait;
        return generate(request, options);
      });
    const retired = reportProvider();
    const oldDispatch = jest.spyOn(retired, 'generate');
    const resolveSelected = jest.fn(async () => {
      const first = resolveSelected.mock.calls.length === 1;
      if (first) await heldSelection.wait;
      return selectedReportProvider(
        mode === 'replaced' && first ? retired : activeProvider,
      );
    });
    const calendarReader = jest.fn(
      async (...args: Parameters<typeof calendar.read>) => {
        await heldCalendar.wait;
        return calendar.read(...args);
      },
    );
    const run = createDailyReportService({
      database: f.database,
      now: () => '2035-01-01T12:00:00Z',
      createRunId: () => 'synthetic-receipt-run',
      consent: { authorize: async () => 'authorized' },
      resolveSelected,
      captureSelectionCurrent: () => selectionOwner.capture() ?? undefined,
      calendarReader,
    });
    function History() {
      const session = useSyncExternalStore(
        sessions.subscribe,
        sessions.getSnapshot,
      ).sessions[0]!;
      return (
        <ConversationHistory
          messages={session.messages}
          pendingMessage={session.pendingMessage}
          requestSessionId={session.id}
          requestActivity={session.requestActivity}
          error=""
          onOpenSource={() => {}}
          onLinkError={() => {}}
        />
      );
    }
    const receipt = () => screen.getByTestId('conversation-message-receipt');
    let pending: Promise<unknown> | undefined;
    try {
      await prepareReportDatabase(f.database);
      const ui = await render(<History />);
      try {
        await act(() => {
          pending = sessions.sendQuickPrompt(
            1,
            conversationIntentRequests['daily-report'],
            async (_question, _history, signal, observer) => {
              const result = await run({
                ...reportRequest(signal),
                // Exercise the final provider receipt in isolation; this excludes
                // the separately tested optional contextual opening.
                observer: { onProviderReceipt: observer?.onProviderReceipt },
              });
              return result.status === 'completed'
                ? {
                    status: 'answer',
                    answer: 'Synthetic report ready',
                    citations: [],
                  }
                : { status: 'failure', kind: 'cancelled' };
            },
          );
        });
        await waitFor(() => expect(calendarReader).toHaveBeenCalledTimes(1));
        // Both independent preflight branches have started with neither released.
        expect(resolveSelected).toHaveBeenCalledTimes(1);
        expect(receipt()).toHaveTextContent(/전송 중/);
        expect(dispatch).not.toHaveBeenCalled();
        if (mode === 'replaced') {
          // The stale async resolver stays held even after the replacement runs.
          selectionOwner.begin()();
        } else if (mode === 'current') {
          await act(() => heldSelection.release());
        }
        if (mode === 'stopped') {
          await act(() => sessions.cancel(1));
          await act(() => heldCalendar.release());
          await act(async () => pending);
          expect(dispatch).not.toHaveBeenCalled();
          expect(receipt()).not.toHaveTextContent(/읽음/);
          return;
        }
        await act(() => heldCalendar.release());
        await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
        expect(resolveSelected).toHaveBeenCalledTimes(
          mode === 'replaced' ? 2 : 1,
        );
        expect(oldDispatch).not.toHaveBeenCalled();
        expect(receipt()).toHaveTextContent(/전송 중/);
        if (!providerStart)
          throw new Error('Missing real provider callback option.');
        await act(() => providerStart?.());
        expect(receipt()).toHaveTextContent(/읽음/);
        expect(screen.queryByText('Synthetic report ready')).toBeNull();
        await act(() => heldResponse.release());
        await screen.findByText('Synthetic report ready');
      } finally {
        await act(async () => {
          heldCalendar.release();
          heldSelection.release();
          heldResponse.release();
          await pending;
        });
        await ui.unmount();
      }
    } finally {
      sessions.dispose();
      f.close();
    }
  },
);
