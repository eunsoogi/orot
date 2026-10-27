import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { FeatureEntryScreen } from '../FeatureEntryScreen';

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const measuredBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();

beforeEach(() => measuredBounds.clear());

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = measuredBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 600);
  });

function layoutAxis(): string | undefined {
  return StyleSheet.flatten(
    screen.getByTestId('ai-feature-columns').props.style,
  )?.flexDirection;
}

// Supply the same window-coordinate measurement that the native shell gives the panel host.
async function measureHost(width: number): Promise<void> {
  measuredBounds.set('ai-feature-columns-host', { x: 0, width });
  await fireEvent(screen.getByTestId('ai-feature-columns-host'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 600 } },
  });
}

test('explains the four actions and routes each card to its owner', async () => {
  const actions = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
  await render(
    <FeatureEntryScreen
      onOpenVisitQuestions={actions[0]}
      onOpenDiseaseHypotheses={actions[1]}
      onOpenRagConversation={actions[2]}
      onOpenExternalEvidence={actions[3]}
    />,
  );

  expect(screen.getByText('다음 진료 질문')).toBeTruthy();
  expect(screen.getByText('증상 정리')).toBeTruthy();
  expect(screen.getByText('기록과 대화')).toBeTruthy();
  expect(screen.getByText('의학 자료 찾기')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('ai-feature-visit-questions'));
  await fireEvent.press(screen.getByTestId('ai-feature-disease-hypotheses'));
  await fireEvent.press(screen.getByTestId('ai-feature-rag-conversation'));
  await fireEvent.press(screen.getByTestId('ai-feature-external-evidence'));
  actions.forEach(action => expect(action).toHaveBeenCalledTimes(1));
});

test('reflows the ordered entry panels from one to two columns using measured width', async () => {
  const actions = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
  await render(
    <FeatureEntryScreen
      onOpenVisitQuestions={actions[0]}
      onOpenDiseaseHypotheses={actions[1]}
      onOpenRagConversation={actions[2]}
      onOpenExternalEvidence={actions[3]}
    />,
  );

  expect(layoutAxis()).toBe('column');
  await measureHost(640);
  expect(layoutAxis()).toBe('column');
  await measureHost(1400);

  expect(layoutAxis()).toBe('row');
  expect(screen.getByTestId('ai-feature-columns-primary')).toBeTruthy();
  expect(screen.getByTestId('ai-feature-columns-secondary')).toBeTruthy();
  for (const id of [
    'visit-questions',
    'disease-hypotheses',
    'rag-conversation',
    'external-evidence',
  ]) {
    expect(screen.getByTestId(`ai-feature-${id}`)).toBeTruthy();
  }
  actions.forEach(action => expect(action).not.toHaveBeenCalled());
});
