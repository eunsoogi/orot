import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';

type MemorySettingsKeys = 'settings.automaticMemory' | 'settings.routineMemory';

type DeviceModule =
  typeof import('../storage/ordinaryConversationMemoryDeviceOwner');
type Owner = Awaited<
  ReturnType<DeviceModule['openOrdinaryConversationMemoryOwner']>
>;
type Connection = {
  readonly owner: Owner;
  readonly read: () => Promise<'on' | 'off' | 'unavailable'>;
};
type Status =
  | 'checking'
  | 'on'
  | 'off'
  | 'unavailable'
  | 'enabling'
  | 'disabling'
  | 'enableError'
  | 'disableError';

const isError = (status: Status) =>
  status === 'unavailable' ||
  status === 'enableError' ||
  status === 'disableError';

/** This local choice neither grants nor revokes any AI external-transfer scope. */
export function SettingsAutomaticMemorySection({
  ownership,
  routine = false,
}: {
  readonly ownership?: NavigationRouteOwnership;
  readonly routine?: boolean;
}) {
  const settingsKey = routine
    ? 'settings.routineMemory'
    : 'settings.automaticMemory';
  const testId = routine
    ? 'settings-routine-memory'
    : 'settings-automatic-memory';
  const [status, setStatus] = useState<Status>('checking');
  const routeOwner = useRef<{
    connection?: Connection;
    attempt?: object;
    refresh(): void;
    current(): boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (!ownership) return;
    let active = false;
    const current = (): boolean =>
      routeOwner.current === scope && active && ownership.isCurrent();
    const scope: NonNullable<typeof routeOwner.current> = {
      current,
      async refresh() {
        if (!current() || scope.attempt) return;
        const attempt = {};
        scope.attempt = attempt;
        const live = () => current() && scope.attempt === attempt;
        setStatus('checking');
        try {
          // Do not load the native storage bridge for an unowned route.
          const ports =
            require('../storage/ordinaryConversationMemoryDeviceOwner') as DeviceModule;
          if (!live()) return;
          const api = routine
            ? ports.authoredRoutineMemoryDeviceOwner
            : {
                openOwner: ports.openOrdinaryConversationMemoryOwner,
                readSettings: ports.readOrdinaryConversationMemorySettings,
              };
          const owner = await api.openOwner();
          if (!live()) return;
          const read = () => api.readSettings(owner);
          scope.connection = { owner, read };
          const next = await read();
          if (live()) setStatus(next);
        } catch {
          if (live()) setStatus('unavailable');
        } finally {
          if (live()) scope.attempt = undefined;
        }
      },
    };
    routeOwner.current = scope;
    const sync = () => {
      const next = ownership.isCurrent();
      if (next === active) return;
      active = next;
      // This invalidates a pending enable before a logical route change returns,
      // even where native navigation retains the previous screen instance.
      scope.attempt = undefined;
      scope.connection = undefined;
      if (next) scope.refresh();
    };
    const unsubscribe = ownership.subscribe(sync);
    sync();
    return () => {
      active = false;
      scope.attempt = undefined;
      if (routeOwner.current === scope) routeOwner.current = null;
      unsubscribe();
    };
  }, [ownership, routine]);

  const change = (enabled: boolean) => {
    const scope = routeOwner.current;
    const connection = scope?.connection;
    if (!scope?.current() || !connection || scope.attempt) return;
    const { owner, read } = connection;
    const attempt = {};
    scope.attempt = attempt;
    const current = () => scope.current() && scope.attempt === attempt;
    // Revoke synchronously on tap, before either the UI or native storage can yield.
    const result = enabled ? owner.enable(current) : owner.revoke();
    setStatus(enabled ? 'enabling' : 'disabling');
    const error = enabled ? 'enableError' : 'disableError';
    result
      .then(async saved => {
        if (!current()) return;
        if (!saved) {
          setStatus(error);
          return;
        }
        const observed = await read();
        if (current())
          setStatus(observed === (enabled ? 'on' : 'off') ? observed : error);
      })
      .catch(() => {
        if (current()) setStatus(error);
      })
      .finally(() => {
        if (current()) scope.attempt = undefined;
      });
  };

  const displayStatus = ownership ? status : 'unavailable';
  return (
    <View style={styles.card} testID={testId}>
      <Text accessibilityRole="header" style={styles.title}>
        {t(`${settingsKey}.title`)}
      </Text>
      <Text style={styles.body}>{t(`${settingsKey}.description`)}</Text>
      <Text style={styles.body}>{t(`${settingsKey}.retention`)}</Text>
      <Text style={styles.body}>{t(`${settingsKey}.backup`)}</Text>
      <Text
        accessibilityRole={isError(displayStatus) ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        style={styles.body}
        testID={`${testId}-status`}
      >
        {t(`${settingsKey}.${displayStatus}`)}
      </Text>
      {displayStatus === 'unavailable' && routeOwner.current?.connection ? (
        <Text style={styles.body}>{t(`${settingsKey}.recovery`)}</Text>
      ) : null}
      {displayStatus === 'off' ? (
        <MemoryAction
          settingsKey={settingsKey}
          testId={testId}
          action="enable"
          onPress={() => change(true)}
        />
      ) : null}
      {displayStatus === 'on' ||
      (isError(displayStatus) && routeOwner.current?.connection) ? (
        <MemoryAction
          settingsKey={settingsKey}
          testId={testId}
          action="disable"
          onPress={() => change(false)}
        />
      ) : null}
      {isError(displayStatus) && ownership ? (
        <MemoryAction
          settingsKey={settingsKey}
          testId={testId}
          action="retry"
          onPress={() => routeOwner.current?.refresh()}
        />
      ) : null}
    </View>
  );
}

function MemoryAction({
  action,
  settingsKey,
  testId,
  onPress,
}: {
  readonly action: 'enable' | 'disable' | 'retry';
  readonly settingsKey: MemorySettingsKeys;
  readonly testId: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.action}
      testID={`${testId}-${action}`}
    >
      <Text style={styles.actionText}>{t(`${settingsKey}.${action}`)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 18,
    gap: 8,
    padding: 16,
  },
  title: { color: appColors.text, fontSize: 16, fontWeight: '600' },
  body: { color: appColors.secondary, fontSize: 14, lineHeight: 21 },
  action: { justifyContent: 'center', minHeight: 44 },
  actionText: { color: appColors.primary, fontSize: 15, fontWeight: '600' },
});
