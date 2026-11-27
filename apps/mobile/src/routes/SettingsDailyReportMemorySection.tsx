import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, Switch } from 'react-native';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { SettingsMemoryControl } from './SettingsMemoryControl';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';

type Ports = typeof import('../memory/openSavedGeneratedReportReferences');
type Storage = Awaited<ReturnType<Ports['openSavedGeneratedReportReferences']>>;

type State =
  | { kind: 'loading' | 'error' }
  | { kind: 'ready' | 'writing'; enabled: boolean }
  | { kind: 'write-error'; enabled: boolean };

/** This local control is independent of ordinary preference memory and provider consent. */
export function SettingsDailyReportMemorySection({
  ownership,
}: {
  readonly ownership?: NavigationRouteOwnership;
}) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const scope = useRef<{
    current: () => boolean;
    store?: Storage;
    pending?: object;
    refresh: () => void;
  } | null>(null);

  useLayoutEffect(() => {
    if (!ownership) return;
    let active = false;
    let revision = 0;
    const owner: NonNullable<typeof scope.current> = {
      current: () =>
        scope.current === owner &&
        active &&
        ownership.isCurrent() &&
        AppState.currentState === 'active',
      async refresh() {
        if (!owner.current() || owner.pending) return;
        const requested = ++revision;
        const current = () => owner.current() && revision === requested;
        setState({ kind: 'loading' });
        try {
          const { openSavedGeneratedReportReferences } =
            require('../memory/openSavedGeneratedReportReferences') as Ports;
          if (!current()) return;
          const store = await openSavedGeneratedReportReferences();
          if (!current()) return;
          const enabled = await store.readAutomaticDailyReportMemory();
          if (!current()) return;
          owner.store = store;
          setState({ kind: 'ready', enabled });
        } catch {
          if (current()) setState({ kind: 'error' });
        }
      },
    };
    scope.current = owner;
    const sync = () => {
      const next = ownership.isCurrent() && AppState.currentState === 'active';
      if (active === next) return;
      active = next;
      revision += 1;
      owner.store = undefined;
      owner.pending = undefined;
      if (next) owner.refresh();
    };
    const unsubscribe = ownership.subscribe(sync);
    const appState = AppState.addEventListener('change', sync);
    sync();
    return () => {
      active = false;
      if (scope.current === owner) scope.current = null;
      appState.remove();
      unsubscribe();
    };
  }, [ownership]);

  const change = async (enabled: boolean) => {
    const owner = scope.current;
    const store = owner?.store;
    if (!owner?.current() || !store || owner.pending || !('enabled' in state))
      return;
    const attempt = {};
    owner.pending = attempt;
    const current = () => owner.current() && owner.pending === attempt;
    const previous = state.enabled;
    const result = store.changeAutomaticDailyReportMemory(enabled, current);
    setState({ kind: 'writing', enabled: previous });
    try {
      const saved = await result;
      if (!current()) return;
      const read = await store.readAutomaticDailyReportMemory();
      if (!current()) return;
      setState(
        saved && read === enabled
          ? { kind: 'ready', enabled }
          : { kind: 'write-error', enabled: previous },
      );
    } catch {
      if (current()) setState({ kind: 'write-error', enabled: previous });
    } finally {
      if (current()) owner.pending = undefined;
    }
  };
  return (
    <SettingsMemoryControl
      title={t('settings.dailyReportMemory.title')}
      description={[
        t('settings.dailyReportMemory.description'),
        t('settings.dailyReportMemory.retention'),
      ]}
      testID="settings-daily-report-memory"
      control={
        'enabled' in state ? (
          <Switch
            testID="settings-daily-report-memory-toggle"
            accessibilityLabel={t('settings.dailyReportMemory.title')}
            disabled={state.kind === 'writing'}
            value={state.enabled}
            onValueChange={next => {
              if (state.kind !== 'writing' && next !== state.enabled)
                change(next);
            }}
          />
        ) : undefined
      }
    >
      {state.kind === 'error' || state.kind === 'write-error' ? (
        <AppText accessibilityRole="alert">
          {t('settings.automaticMemory.unavailable')}
        </AppText>
      ) : null}
    </SettingsMemoryControl>
  );
}
