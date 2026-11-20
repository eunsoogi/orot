import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import type { RagConversationOutcome } from '../service';
import * as i18n from '../../i18n';
type Sender = React.ComponentProps<typeof ConversationScreen>['onSend'];
const earlier = (n: number, m: number) => ({
  sourceKind: 'personal_record' as const,
  sourceId: `synthetic-${n}-${m}`,
  sourceRevision: 'r1',
  evidenceId: `synthetic-evidence-${n}-${m}`,
  evidenceRevision: 'r1',
  locator: { kind: 'structured_record', recordId: `synthetic-${n}-${m}` },
  effectiveTime: '2026-01-04T00:00:00Z',
  reviewState: 'reviewed' as const,
});
test('active text previews do not reformat settled citation labels or change actions', async () => {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const translations = jest.spyOn(i18n, 't');
  const citationCalls = () =>
    translations.mock.calls.filter(
      ([key]) => key === 'ragConversation.conversation.linkEvidenceSource',
    ).length;
  let finish!: (value: RagConversationOutcome) => void;
  let observer: Parameters<Sender>[3];
  let signal: AbortSignal | undefined;
  const onSend = jest.fn<ReturnType<Sender>, Parameters<Sender>>();
  for (let n = 0; n < 8; n++)
    onSend.mockResolvedValueOnce({
      status: 'answer',
      answer: `Synthetic answer ${n}`,
      citations: [earlier(n, 0), earlier(n, 1)],
    });
  onSend.mockImplementationOnce((_q, _h, s, o) => {
    signal = s;
    observer = o;
    return new Promise(resolve => {
      finish = resolve;
    });
  });
  const onOpenSource = jest.fn();
  const view = await render(
    <ConversationScreen
      onBack={jest.fn()}
      onOpenSource={onOpenSource}
      onSend={onSend}
    />,
  );
  const send = async (q: string) => {
    await fireEvent.changeText(screen.getByTestId('rag-conversation-input'), q);
    await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  };
  try {
    for (let n = 0; n < 8; n++) {
      await send(`Synthetic question ${n}`);
      expect(await screen.findByText(`Synthetic answer ${n}`)).toBeTruthy();
    }
    expect(screen.getAllByLabelText(/원문 근거 열기/u)).toHaveLength(16);
    await send('Active question');
    await act(async () => observer?.onProviderReceipt?.('response_started'));
    const calls: number[] = [];
    for (let n = 0; n < 12; n++) {
      const before = citationCalls();
      await act(async () => {
        observer?.onTaskStreamEvent?.({
          type: 'text_delta',
          text: ` token${n}`,
        });
        await new Promise(resolve => setTimeout(resolve, 20));
      });
      expect(screen.getByTestId('rag-conversation-stream')).toHaveTextContent(
        new RegExp(`token${n}$`),
      );
      calls.push(citationCalls() - before);
    }
    expect(signal?.aborted).toBe(false);
    await fireEvent.press(screen.getAllByLabelText(/원문 근거 열기/u)[0]);
    expect(onOpenSource).toHaveBeenCalledWith(earlier(0, 0));
    await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      finish({
        status: 'answer',
        answer: 'Late synthetic terminal must not appear',
        citations: [],
      }),
    );
    expect(
      screen.queryByText('Late synthetic terminal must not appear'),
    ).toBeNull();
    expect(calls).toEqual(Array(12).fill(0));
  } finally {
    await view.unmount();
    jest.restoreAllMocks();
  }
});
