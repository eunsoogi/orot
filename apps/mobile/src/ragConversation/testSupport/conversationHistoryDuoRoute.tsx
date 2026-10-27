import { fireEvent, screen } from '@testing-library/react-native';
import { Dimensions, View } from 'react-native';
import type {
  EvidenceReference,
  ExecutionConsentPort,
} from '@orot/agent-runtime';
import { AiFeatureSharedNavigationStateProvider } from '../../aiFeatures/integration/AiFeatureSharedNavigationState';
import type { AiFeatureServices } from '../../aiFeatures/integration/featureServices';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { AppAiFeatureScene } from '../../routes/AppAiFeatureScene';
import { createConversationSessions } from '../conversationSessions';

export const originalWindow = Dimensions.get('window');
const measuredBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();
const historyHostId = 'conversation-history-measurement-host';

export const sourceReference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-source',
  sourceRevision: 'synthetic-revision',
  evidenceId: 'synthetic-evidence',
  evidenceRevision: 'synthetic-revision',
  locator: { kind: 'local-evidence', token: 'e1' },
  effectiveTime: '2026-10-20T08:00:00+09:00',
  reviewState: 'unreviewed',
};

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = measuredBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 900);
  });

export function windowSize(width: number, fontScale = 1) {
  return { ...originalWindow, width, height: 900, fontScale };
}

export function clearHistoryMeasurements() {
  measuredBounds.clear();
}

export function setMeasuredHistoryHost(x: number, width: number) {
  measuredBounds.set(historyHostId, { x, width });
}

// Measure the screen-owned parent using the same window coordinates as native geometry.
export async function measureHistoryHost(x: number, width: number) {
  setMeasuredHistoryHost(x, width);
  await fireEvent(screen.getByTestId(historyHostId), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 900 } },
  });
}

export function nativeGeometry(
  width: number,
  divided: boolean,
): NavigationGeometryPayload {
  return {
    windowBounds: { x: 0, y: 0, width, height: 900 },
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    reservedRegionsSupported: divided,
    reservedRegions: divided
      ? [
          {
            id: 'duo-division',
            kind: 'division',
            frame: { x: 640, y: 0, width: 120, height: 900 },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            isActive: true,
          },
        ]
      : [],
  };
}

export async function saveAnswer(
  store: ReturnType<typeof createConversationSessions>,
  question: string,
  answer: string,
  citations: readonly EvidenceReference[] = [],
) {
  const id = store.getSnapshot().activeId;
  store.setDraft(id, question);
  await store.send(id, async () => ({ status: 'answer', answer, citations }));
}

/** Exercises the app route adapter and its screen-owned content-layout policy. */
export function ProductionHistoryRoute({
  controller,
}: {
  readonly controller: ReturnType<
    typeof createNavigationController<AppNavigationRoute>
  >;
}) {
  const consent = {
    authorize: async () => 'authorized' as const,
  } as unknown as ExecutionConsentPort;
  const services = {
    sendRagMessage: jest.fn(),
  } as unknown as AiFeatureServices;

  return (
    <AiFeatureSharedNavigationStateProvider>
      <NavigationRouteAdapter
        contentLayoutOwner={appContentLayoutOwner}
        controller={controller}
      >
        {actions => (
          <AppAiFeatureScene
            actions={actions}
            consent={consent}
            services={services}
          />
        )}
      </NavigationRouteAdapter>
    </AiFeatureSharedNavigationStateProvider>
  );
}
