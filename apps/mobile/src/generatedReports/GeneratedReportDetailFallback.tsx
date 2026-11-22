import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { GeneratedReportBookmarkAction } from './GeneratedReportBookmarkAction';
import { GeneratedReportContent } from './GeneratedReportContent';
import { GeneratedReportFrame } from './GeneratedReportRows';
import { generatedReportCopy as copy } from './text';
import type { GeneratedReportDetail, GeneratedReportRow } from './types';

export type GeneratedReportDetailFallbackState =
  | { readonly status: 'loading' | 'failed' | 'unavailable' }
  | {
      readonly status: 'ready';
      readonly detail: GeneratedReportDetail;
      readonly generation: number;
    };

/** Reuse the existing reader surface without adding an in-content Back. */
export function GeneratedReportDetailFallback({
  row,
  state,
  onRetry,
  isCurrent,
}: {
  readonly row: GeneratedReportRow;
  readonly state: GeneratedReportDetailFallbackState;
  readonly onRetry: () => void;
  readonly isCurrent: () => boolean;
}) {
  return (
    <GeneratedReportFrame destination selected>
      <AppText accessibilityRole="header">{copy[row.kind]}</AppText>
      {state.status === 'ready' ? (
        <>
          <GeneratedReportContent detail={state.detail} />
          {state.detail.bookmarkOriginal ? (
            <GeneratedReportBookmarkAction
              key={state.generation}
              bookmark={state.detail.bookmarkOriginal}
              current={isCurrent}
            />
          ) : null}
        </>
      ) : state.status === 'loading' ? (
        <AppText accessibilityLiveRegion="polite">{copy.loading}</AppText>
      ) : (
        <>
          <AppText accessibilityRole="alert">{copy[state.status]}</AppText>
          {state.status === 'failed' ? (
            <AppButton title={copy.retry} onPress={onRetry} />
          ) : null}
        </>
      )}
    </GeneratedReportFrame>
  );
}
