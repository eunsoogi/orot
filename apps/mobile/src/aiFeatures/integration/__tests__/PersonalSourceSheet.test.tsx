import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Dimensions } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { ConversationToolEventSources as MockToolSources } from '../../../ragConversation/ConversationToolEventSources';
import {
  personalSourceCaptures,
  type ResolveConversationToolSource,
} from '../../../ragConversation/personalToolSourceRoute';
import { conversationToolEventFixtures as mockEvents } from '../../../ragConversation/testSupport/conversationToolEventFixtures';
import type { EvidenceSourceReadResult } from '../evidenceRegistry';
import type { AiFeatureFlowScreenProps } from '../AiFeatureFlowScreenTypes';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { t } from '../../../i18n';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../featureServices', () => ({
  createAiFeatureServices: () => mockServices,
}));
jest.mock('../AiFeatureFlowScreen', () => ({
  AiFeatureFlowScreen: (props: AiFeatureFlowScreenProps) => (
    <MockToolSources
      event={mockEvents[0]!}
      sessionId="synthetic-session"
      durableMessageId="synthetic-message"
      resolveToolSource={mockResolve}
      allowSourceActions={props.isEntryCurrent?.() ?? true}
      onOpenSource={props.onOpenSource}
      onLinkError={jest.fn()}
    />
  ),
}));

const mockResolve = jest.fn<
  ReturnType<ResolveConversationToolSource>,
  Parameters<ResolveConversationToolSource>
>();
const mockServices = {
  conversationSessionOptions: () => undefined,
  readSource: jest.fn<
    Promise<EvidenceSourceReadResult>,
    [EvidenceReference, AbortSignal]
  >(),
};

const reference = {
  ...mockEvents[0]!.sources[0],
  locator: { kind: 'local-evidence', token: 'synthetic' },
  effectiveTime: '2026-01-01T00:00:00.000Z',
  reviewState: 'reviewed',
} satisfies EvidenceReference;
const available: EvidenceSourceReadResult = {
  status: 'available',
  document: {
    sourceKind: 'personal_record',
    records: [
      {
        kind: 'source_record',
        record: {
          id: 'private-opaque-id',
          sourceKind: 'device_export',
          title: 'Synthetic selected source',
          effectiveAt: reference.effectiveTime,
          recordedAt: reference.effectiveTime,
          ingestedAt: reference.effectiveTime,
          provenance: { origin: 'imported', sourceRecordIds: [] },
          reviewState: { status: 'unreviewed' },
        },
      },
    ],
  },
};

const beforeWindow = Dimensions.get('window');
const beforeScreen = Dimensions.get('screen');
const beforePhase = AppState.currentState;
beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(false);
});
afterEach(() => {
  personalSourceCaptures.delete(mockResolve);
  AppState.currentState = beforePhase;
  Dimensions.set({ window: beforeWindow, screen: beforeScreen });
  jest.restoreAllMocks();
});

const chip = () =>
  screen.getByRole('button', {
    name: `${t('ragConversation.tool.openSource')} · ${t('ragConversation.tool.sourceKind.personalRecord')}`,
  });
const sheetId = 'conversation-personal-source-sheet';

function holdAdmission() {
  const lease = new AbortController();
  let finish!: (value: EvidenceReference | undefined) => void;
  const admit = jest.fn(
    () =>
      new Promise<EvidenceReference | undefined>(settle => {
        finish = settle;
      }),
  );
  const capture = jest.fn(() => ({
    signal: lease.signal,
    current: () => !lease.signal.aborted,
    retire: () => lease.abort(),
    admit,
  }));
  personalSourceCaptures.set(mockResolve, capture);
  return {
    retire: () => lease.abort(),
    finish: (value: EvidenceReference | undefined) => finish(value),
    admit,
    capture,
    signal: lease.signal,
  };
}

test.each([320, 852])(
  'personal source uses native sheet at width %i and renders only verified detail',
  async width => {
    const dimensions = { ...beforeWindow, width, height: 700 };
    Dimensions.set({ window: dimensions, screen: dimensions });
    const f = holdAdmission();
    mockServices.readSource.mockResolvedValue(available);
    await render(
      <AiFeatureRoute initialRoute="rag-conversation" onBack={jest.fn()} />,
    );
    await fireEvent.press(chip());
    const sheet = await screen.findByTestId(sheetId);
    expect(
      screen.getAllByTestId(/navigation-route-scene-route-/u, {
        includeHiddenElements: true,
      }),
    ).toHaveLength(2);
    expect(sheet.props).toMatchObject({
      presentationStyle: 'pageSheet',
      animationType: 'slide',
      allowSwipeDismissal: true,
    });
    expect(screen.getByTestId('ai-feature-source-loading')).toBeVisible();
    expect(screen.queryByText('Synthetic selected source')).toBeNull();
    expect(mockServices.readSource).not.toHaveBeenCalled();
    expect(f.capture).toHaveBeenCalledWith(
      mockEvents[0]!.sources[0],
      expect.objectContaining({ durableMessageId: 'synthetic-message' }),
    );
    const origin = screen.getAllByTestId('ai-feature-screen-content', {
      includeHiddenElements: true,
    });
    expect(
      origin.some(
        view =>
          view.props.accessibilityElementsHidden === true &&
          view.props.pointerEvents === 'none',
      ),
    ).toBe(true);
    await fireEvent(screen.getByTestId('ai-feature-source-detail'), 'layout');
    expect(f.admit).toHaveBeenCalledTimes(1);
    await act(() => f.finish(reference));
    expect(await screen.findByText('Synthetic selected source')).toBeVisible();
    expect(mockServices.readSource).toHaveBeenCalledWith(
      reference,
      expect.any(AbortSignal),
    );
    expect(mockResolve).not.toHaveBeenCalled();
    expect(screen.queryByText('private-opaque-id')).toBeNull();
    expect(screen.queryByTestId('ai-feature-source-selection')).toBeNull();
    await fireEvent.press(
      screen.getByTestId('conversation-personal-source-close'),
    );
    expect(screen.queryByTestId(sheetId)).toBeNull();
    expect(f.signal.aborted).toBe(true);
    expect(chip()).toBeVisible();
  },
);

test('native dismissal retires held personal admission, and its late result never reads or paints', async () => {
  const f = holdAdmission();
  await render(
    <AiFeatureRoute initialRoute="rag-conversation" onBack={jest.fn()} />,
  );
  await fireEvent.press(chip());
  const sheet = await screen.findByTestId(sheetId);
  await fireEvent(screen.getByTestId('ai-feature-source-detail'), 'layout');
  expect(f.admit).toHaveBeenCalledTimes(1);
  await fireEvent(sheet, 'requestClose');
  expect(f.signal.aborted).toBe(true);
  await act(() => f.finish(reference));
  expect(mockServices.readSource).not.toHaveBeenCalled();
  expect(screen.queryByTestId(sheetId)).toBeNull();
});

test.each(['denied', 'lock'] as const)(
  '%s switches neutral progress to unavailable in the same closable sheet',
  async reason => {
    const f = holdAdmission();
    await render(
      <AiFeatureRoute initialRoute="rag-conversation" onBack={jest.fn()} />,
    );
    await fireEvent.press(chip());
    await screen.findByTestId(sheetId);
    await fireEvent(screen.getByTestId('ai-feature-source-detail'), 'layout');
    await act(() => {
      if (reason === 'lock') f.retire();
      f.finish(reason === 'lock' ? reference : undefined);
    });
    expect(screen.getByTestId('ai-feature-source-unavailable')).toBeVisible();
    expect(screen.getByTestId(sheetId)).toBeVisible();
    expect(mockServices.readSource).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByTestId('conversation-personal-source-close'),
    );
    expect(screen.queryByTestId(sheetId)).toBeNull();
  },
);
