import type { VisitQuestionRouteGeneration } from '../src/aiFeatures/integration/visitQuestionsRouteOperations';

type Ready = Extract<VisitQuestionRouteGeneration, { status: 'ready' }>;

/** Test-entry-only states exercise the real route without inference, source reads or timed transitions. */
export function createVisitGenerationVisualRun(
  setting: unknown,
  ready: () => Promise<Ready>,
): (input: {
  readonly signal: AbortSignal;
}) => Promise<VisitQuestionRouteGeneration> {
  if (
    setting !== undefined &&
    setting !== 'pending' &&
    setting !== 'unavailable' &&
    setting !== 'needs_clarification'
  )
    throw new Error('Unsupported visit generation visual state');
  return async ({ signal }) => {
    if (signal.aborted) return { status: 'cancelled' };
    if (setting === undefined) return ready();
    if (setting === 'pending') {
      // Only the real route's cancellation ends the fixture; wall-clock timing cannot select a result.
      return new Promise(resolve => {
        signal.addEventListener(
          'abort',
          () => resolve({ status: 'cancelled' }),
          { once: true },
        );
      });
    }
    return {
      status: setting,
      message:
        setting === 'unavailable'
          ? '합성 요청을 완료하지 못했어요. 다시 시도해 주세요.'
          : '합성 기록만으로는 질문을 만들 근거가 부족해요. 기록을 확인해 주세요.',
    };
  };
}
