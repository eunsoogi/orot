import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, Switch } from 'react-native';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import { subscribeLocalDataClear } from '../storage/localDataClearEvents';
import {
  SettingsMemoryControl,
  settingsMemorySwitchStyle,
} from './SettingsMemoryControl';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';

type Ports = typeof import('../memory/openSavedGeneratedReportReferences');
type Storage = Awaited<ReturnType<Ports['openSavedGeneratedReportReferences']>>;
const openReferences = () =>
  (
    require('../memory/openSavedGeneratedReportReferences') as Ports
  ).openSavedGeneratedReportReferences();

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
    let routeCurrent = false;
    let protectedDataLocked = false;
    let hasSnapshot = false;
    let revision = 0;
    let reading: number | undefined;
    const owner: NonNullable<typeof scope.current> = {
      current: () =>
        scope.current === owner &&
        active &&
        !protectedDataLocked &&
        ownership.isCurrent() &&
        AppState.currentState === 'active',
      async refresh() {
        if (
          !owner.current() ||
          owner.pending ||
          hasSnapshot ||
          reading !== undefined
        )
          return;
        const requested = ++revision;
        reading = requested;
        const current = () => owner.current() && revision === requested;
        setState({ kind: 'loading' });
        try {
          const store = await openReferences();
          if (!current()) return;
          const enabled = await store.readAutomaticDailyReportMemory();
          if (!current()) return;
          owner.store = store;
          hasSnapshot = true;
          setState({ kind: 'ready', enabled });
        } catch {
          if (current()) setState({ kind: 'error' });
        } finally {
          if (reading === requested) reading = undefined;
        }
      },
    };
    scope.current = owner;
    const retire = () => {
      revision += 1;
      reading = undefined;
      owner.store = undefined;
      // An interrupted write is the only phase transition that can change the durable value.
      if (owner.pending) hasSnapshot = false;
      owner.pending = undefined;
    };
    const invalidate = () => {
      hasSnapshot = false;
      retire();
      setState({ kind: 'loading' });
      owner.refresh();
    };
    const sync = () => {
      const ownsRoute = ownership.isCurrent();
      if (routeCurrent && !ownsRoute) invalidate();
      routeCurrent = ownsRoute;
      const next = ownsRoute && AppState.currentState === 'active';
      if (active === next) return;
      active = next;
      // Release the secure handle and retire late work, but keep a settled presentation.
      retire();
      if (next) owner.refresh();
    };
    const unsubscribe = ownership.subscribe(sync);
    const dataClear = subscribeLocalDataClear(invalidate);
    const protection = conversationExecutionNative();
    const stopProtection = protection?.bridgeAvailable
      ? protection.subscribe(event => {
          if (event.kind !== 'protectedData') return;
          protectedDataLocked = !event.available;
          if (protectedDataLocked) invalidate();
          else owner.refresh();
        })
      : undefined;
    const appState = AppState.addEventListener('change', sync);
    sync();
    return () => {
      active = false;
      if (scope.current === owner) scope.current = null;
      appState.remove();
      stopProtection?.();
      dataClear();
      unsubscribe();
    };
  }, [ownership]);

  const change = async (enabled: boolean) => {
    const owner = scope.current;
    if (!owner?.current() || owner.pending || !('enabled' in state)) return;
    const attempt = {};
    owner.pending = attempt;
    const current = () => owner.current() && owner.pending === attempt;
    const previous = state.enabled;
    setState({ kind: 'writing', enabled: previous });
    try {
      // A tap may re-open the secure handle after a plain resume; rendering never does.
      const store = owner.store ?? (await openReferences());
      if (!current()) return;
      owner.store = store;
      const saved = await store.changeAutomaticDailyReportMemory(
        enabled,
        current,
      );
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
            style={settingsMemorySwitchStyle}
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
