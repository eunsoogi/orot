import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, View } from 'react-native';
import { t } from '../../i18n';
import { AppButton } from '../../layout/AppButton';
import { AppText } from '../../layout/AppText';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import type { NavigationRouteActions } from '../../navigation/navigationRouteContracts';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { overviewMetricTitle } from './OverviewMetricCard';
import { OverviewMetricSelectionEditor } from './OverviewMetricSelectionEditor';
import { overviewMetricStyles as styles } from './overviewMetricStyles';
import {
  loadOverviewMetricSelection,
  canSaveOverviewMetricSelection,
  saveOverviewMetricSelection,
  type OverviewMetricChoice,
} from './metricSelection';

declare const require: (
  path: '../../storage/secureDatabase',
) => Pick<typeof import('../../storage/secureDatabase'), 'openLocalStorage'>;

// Open only when this editor actually reads or writes its local preference.
async function preferences() {
  return require('../../storage/secureDatabase').openLocalStorage();
}

/** A new stack entry owns its own draft; only explicit Save changes the local checkpoint. */
export function OverviewMetricSelectionRoute({
  actions,
}: {
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
}) {
  const focused = useIsFocused();
  const [draft, setDraft] = useState<readonly OverviewMetricChoice[] | null>(
    null,
  );
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const owner = actions.ownership;
  const current = () =>
    mounted.current && focused && (owner?.isCurrent() ?? true);
  useNavigationLeaveStateRegistration({
    // The shared Back guard sees a Save immediately, even before React commits busy UI.
    get canLeave() {
      return !savingRef.current;
    },
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  useEffect(() => {
    if (!focused) return;
    let reading = true;
    setLoadFailed(false);
    preferences()
      .then(loadOverviewMetricSelection)
      .then(selection => {
        if (reading && (owner?.isCurrent() ?? true)) setDraft(selection);
      })
      .catch(() => {
        if (reading && (owner?.isCurrent() ?? true)) setLoadFailed(true);
      });
    return () => {
      reading = false;
    };
  }, [attempt, focused, owner]);
  const toggle = (metric: OverviewMetricChoice) => {
    if (!current() || savingRef.current) return;
    setDraft(previous =>
      previous?.includes(metric)
        ? previous.filter(item => item !== metric)
        : [...(previous ?? []), metric],
    );
  };
  const move = (metric: OverviewMetricChoice, to: number) => {
    if (!current() || savingRef.current) return;
    setDraft(previous => {
      if (!previous) return previous;
      const from = previous.indexOf(metric);
      if (from < 0 || to < 0 || to >= previous.length || from === to)
        return previous;
      const reordered = [...previous];
      reordered.splice(from, 1);
      reordered.splice(to, 0, metric);
      return reordered;
    });
  };
  const cancel = async () => {
    if (current() && !savingRef.current) await actions.onBack();
  };
  const canSave = Boolean(draft && canSaveOverviewMetricSelection(draft));
  const save = async () => {
    if (!current() || savingRef.current || !draft || !canSave) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    let saved = false;
    try {
      const repository = await preferences();
      if (!current()) return;
      await saveOverviewMetricSelection(repository, draft);
      saved = true;
    } catch {
      if (current()) setSaveError(true);
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
    if (saved && current()) await actions.onBack();
  };
  return (
    <View
      style={[styles.section, routeStyles.content]}
      testID="overview-metric-selection-screen"
    >
      <AppText accessibilityRole="header" style={styles.title}>
        {t('overview.metricSelectionTitle')}
      </AppText>
      {draft ? (
        <OverviewMetricSelectionEditor
          canSave={canSave}
          onCancel={cancel}
          onMove={move}
          onSave={save}
          onToggle={toggle}
          saveError={saveError}
          saving={saving}
          selection={draft}
          title={overviewMetricTitle}
        />
      ) : loadFailed ? (
        <>
          <AppText accessibilityRole="alert">
            {t('overview.metricSelectionLoadError')}
          </AppText>
          <AppButton
            title={t('appointments.retry')}
            onPress={() => current() && setAttempt(previous => previous + 1)}
          />
        </>
      ) : (
        <AppText accessibilityLiveRegion="polite">
          {t('overview.metricSelectionLoading')}
        </AppText>
      )}
    </View>
  );
}

const routeStyles = StyleSheet.create({
  // Match peer settings content margins without changing the Duo rail or scroll owner.
  content: { paddingHorizontal: 20, paddingTop: 16 },
});
