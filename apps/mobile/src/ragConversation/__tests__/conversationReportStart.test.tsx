import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { createConversationSessions } from '../conversationSessions';
import { useRequestedReportStart } from '../conversationReportStart';
import { requestConversationReport } from '../requestConversationReport';
import { todayIdentity } from '../../aiFeatures/integration/dailyReportTodayIdentity';

test('only an explicit live tap gives one claim; restored cards never do', async () => {
  const store = createConversationSessions();
  const cardId = `daily-report:${todayIdentity()!.key}`;
  let claim: (() => boolean) | undefined;
  function Probe() {
    claim = useRequestedReportStart(store, 1, cardId);
    return <Text>{claim ? 'requested' : 'idle'}</Text>;
  }
  const view = await render(<Probe />);
  await act(async () => {
    await requestConversationReport(store, () => true);
  });
  expect(screen.getByText('idle')).toBeTruthy();
  await act(async () => {
    await requestConversationReport(store, () => true, undefined, true);
  });
  expect(screen.getByText('requested')).toBeTruthy();
  expect(claim!()).toBe(true);
  expect(claim!()).toBe(false);
  await view.unmount();
  await render(<Probe />);
  expect(screen.getByText('idle')).toBeTruthy();
  store.dispose();
});

test('unmount or changed session discards a pending live start', async () => {
  const store = createConversationSessions();
  const cardId = `daily-report:${todayIdentity()!.key}`;
  let claim: (() => boolean) | undefined;
  function Probe() {
    claim = useRequestedReportStart(store, 1, cardId);
    return null;
  }
  const view = await render(<Probe />);
  await act(async () => {
    await requestConversationReport(store, () => true, undefined, true);
  });
  const old = claim!;
  await view.unmount();
  expect(old()).toBe(false);
  await render(<Probe />);
  await act(async () => {
    await requestConversationReport(store, () => true, undefined, true);
  });
  store.create();
  expect(claim!()).toBe(false);
  store.dispose();
});

test('the same date card in a retained other session cannot consume the active session request', async () => {
  const store = createConversationSessions();
  const cardId = `daily-report:${todayIdentity()!.key}`;
  await requestConversationReport(store, () => true);
  store.create();
  const secondId = store.getSnapshot().activeId;
  let firstClaim: (() => boolean) | undefined;
  let secondClaim: (() => boolean) | undefined;
  function Probe() {
    firstClaim = useRequestedReportStart(store, 1, cardId);
    secondClaim = useRequestedReportStart(store, secondId, cardId);
    return null;
  }
  await render(<Probe />);
  await act(async () => {
    await requestConversationReport(store, () => true, undefined, true);
  });
  expect(firstClaim).toBeUndefined();
  expect(secondClaim!()).toBe(true);
  expect(secondClaim!()).toBe(false);
  store.dispose();
});
