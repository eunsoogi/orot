import { useLayoutEffect, useRef } from 'react';
import { ActionSheetIOS } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';

type Choice = {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly run: () => void | Promise<void>;
};

/** Menu edges belong to the existing dock action, never to a selected export or rename. */
export function RecordingDetailActionMenu({
  id,
  label,
  icon,
  choices,
  sourceId,
  active,
  owner,
}: {
  id: string;
  label: string;
  icon: string;
  sourceId: string;
  active: boolean;
  owner?: NavigationRouteOwnership;
  choices: readonly Choice[];
}) {
  const opened = useRef<symbol | undefined>(undefined);
  const latest = useRef(choices);
  latest.current = choices;
  const retire = () => {
    const token = opened.current;
    opened.current = undefined;
    if (token) ActionSheetIOS.dismissActionSheet();
  };
  useLayoutEffect(() => {
    const unregister = owner?.subscribe(() => {
      if (!owner.isCurrent()) retire();
    });
    return () => {
      unregister?.();
      retire();
    };
  }, [active, owner, sourceId]);
  const onPress = () => {
    if (!active || owner?.isCurrent() === false || opened.current) return;
    const entries = latest.current;
    if (!entries.some(item => !item.disabled)) return;
    const token = Symbol(id);
    opened.current = token;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [
          ...entries.map(option => option.label),
          t('recording.library.cancel'),
        ],
        cancelButtonIndex: entries.length,
        disabledButtonIndices: entries.flatMap((option, index) =>
          option.disabled ? [index] : [],
        ),
      },
      index => {
        if (opened.current !== token) return;
        opened.current = undefined;
        if (owner?.isCurrent() === false) return;
        const selected = latest.current.find(
          item => item.id === entries[index]?.id,
        );
        if (selected && !selected.disabled) void selected.run();
      },
    );
  };
  const disabled = !active || !choices.some(option => !option.disabled);
  const dock = useNavigationRouteActions(
    [
      {
        id,
        label,
        testID: id,
        systemImageName: icon,
        accessibilityLabel: label,
        disabled,
        onPress,
      },
    ],
    active,
  );
  return dock ? null : (
    <AppButton
      title={label}
      testID={id}
      disabled={disabled}
      onPress={onPress}
      variant="secondary"
    />
  );
}
