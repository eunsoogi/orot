import type { render } from '@testing-library/react-native';
import { assertOrder } from './assertSyntheticTranscriptOrder';

export const observedVoiceFixtureLines = [
  {
    order: 1,
    role: 'assistant',
    text: '안녕',
  },
  { order: 2, role: 'assistant', text: '하세요' },
  { order: 3, role: 'user', text: '오늘' },
  { order: 4, role: 'user', text: ' 날씨' },
  { order: 5, role: 'assistant', text: '날씨는' },
  { order: 7, role: 'assistant', text: '확인할게요' },
] as const;

/** Exact synthetic wire deltas, including a gap that renders as separate captions. */
export function assertObservedVoiceFixture(
  cold: Awaited<ReturnType<typeof render>>,
) {
  assertOrder(
    JSON.stringify(cold.toJSON()),
    '안녕하세요',
    '오늘 날씨',
    '날씨는',
    '확인할게요',
  );
  expect(cold.getByText(/테스트 비서: 안녕하세요/)).toBeTruthy();
  expect(cold.getByText(/오늘 날씨/)).toBeTruthy();
  expect(cold.queryByText(/날씨는확인할게요/)).toBeNull();
}
