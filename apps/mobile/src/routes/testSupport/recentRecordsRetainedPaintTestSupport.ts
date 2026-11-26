import type { RecentMaterialReadyLease } from '../../generatedReports/certifiedRecentMaterialPage';
import { createElement, useState, type PropsWithChildren } from 'react';
import { RecentMaterialReadinessContext } from '../RecentMaterialReadinessContext';
import { act, screen } from '@testing-library/react-native';
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

/** Model foreground read authority retiring independently of the Records view. */
export function captureRecentReadiness(initial: RecentMaterialReadyLease) {
  let update:
    ((value: RecentMaterialReadyLease | undefined) => void) | undefined;
  const set = (value: RecentMaterialReadyLease | undefined) => {
    if (!update) throw new Error('Records readiness fixture not mounted.');
    update(value);
  };
  return {
    Wrapper({ children }: PropsWithChildren) {
      const [ready, setReady] = useState<RecentMaterialReadyLease | undefined>(
        initial,
      );
      update = setReady;
      return createElement(
        RecentMaterialReadinessContext.Provider,
        { value: ready },
        children,
      );
    },
    set,
    async suspend(
      phase: (next: 'inactive' | 'background') => void,
      inactive: boolean,
      revoke: boolean,
    ) {
      if (revoke && inactive) await act(async () => set(undefined));
      await act(async () => phase(inactive ? 'inactive' : 'background'));
      if (revoke && !inactive) await act(async () => set(undefined));
    },
  };
}
