import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const mediaId = 'synthetic-warm-file';
const memoryId = 'synthetic-warm-memory';
const file = 'Synthetic warm file';
const memory = 'records-recent-source-memory:agent:' + memoryId;
const error = 'records-recent-sources-error';
const retry = 'records-recent-sources-retry';

export const fixture = { mediaId, memoryId, file, memory, error, retry };

/** Assert that retained native pixels are still present without enabling interaction. */
export function expectRetainedPaint() {
  const retained = screen.getByTestId('records-recent-sources', {
    includeHiddenElements: true,
  });
  expect(StyleSheet.flatten(retained.props.style)?.opacity).not.toBe(0);
  expect(retained.props.pointerEvents).toBe('none');
  return retained;
}
