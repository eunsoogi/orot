import { act, render, screen, waitFor } from '@testing-library/react-native';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { RetainedManualVisitTargets } from '../RetainedManualVisitTargets';

jest.mock('../ManualVisitRecords', () => ({
  ManualVisitRecords: ({ appointmentId }: { appointmentId: string }) => {
    const { Text } = require('react-native');
    return <Text>{appointmentId}</Text>;
  },
}));

test('a source deletion aborts an older retained-session read before it can expose a visit', async () => {
  let finish!: (page: unknown) => void;
  const pending = new Promise(resolve => {
    finish = resolve;
  });
  const readSession = jest
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce({
      items: [],
      unavailableCount: 0,
      nextCursor: null,
    });
  const discovery = {
    activeSessionVersion: jest.fn().mockResolvedValue(0),
    readSession,
    revalidateSession: jest.fn().mockResolvedValue(true),
  };
  const open = jest.fn().mockResolvedValue(discovery);
  await render(
    <RetainedManualVisitTargets
      sessionId="session"
      discover={open}
      excluded="[]"
    />,
  );
  await waitFor(() => expect(readSession).toHaveBeenCalledTimes(1));
  const signal = readSession.mock.calls[0][0].signal as AbortSignal;
  await act(async () => {
    notifyLocalSourceDeleted();
  });
  expect(signal.aborted).toBe(true);
  await waitFor(() => expect(readSession).toHaveBeenCalledTimes(2));
  await act(async () => {
    finish({
      items: [
        {
          id: 'turn',
          revision: '1',
          visitQuestions: { appointmentId: 'deleted-visit' },
        },
      ],
      unavailableCount: 0,
      nextCursor: null,
    });
  });
  expect(screen.queryByText('deleted-visit')).toBeNull();
});
