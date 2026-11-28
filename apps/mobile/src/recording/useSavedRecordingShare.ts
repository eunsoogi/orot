import { useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { t } from '../i18n';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { recordingExportService } from './recordingExportService';

/** An explicit row tap may present one native chooser while this exact route owns the action. */
export function useSavedRecordingShare(
  ownership: NavigationRouteOwnership | undefined,
) {
  const route = useRef<NavigationRouteOwnership | undefined>(undefined);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    route.current = ownership;
    return () => {
      route.current = undefined;
    };
  }, [ownership]);

  async function share(sourceId: string): Promise<void> {
    if (
      pending.current ||
      AppState.currentState !== 'active' ||
      !ownership ||
      route.current !== ownership ||
      !ownership.isCurrent()
    )
      return;

    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      // The native exporter verifies protection and cleans up its temporary audio copy after UIKit dismisses.
      await recordingExportService.shareAudio(sourceId);
    } catch (reason) {
      if (route.current !== ownership || !ownership.isCurrent()) return;
      const code = (reason as { code?: unknown } | null)?.code;
      setError(
        code === 'RECORDING_EXPORT_CLEANUP_FAILED'
          ? t('recording.export.error.cleanup')
          : code === 'RECORDING_EXPORT_SOURCE_MISSING'
            ? t('recording.export.error.missingAudio')
            : t('recording.export.error.share'),
      );
    } finally {
      pending.current = false;
      if (route.current) setBusy(false);
    }
  }

  return { busy, error, share };
}
