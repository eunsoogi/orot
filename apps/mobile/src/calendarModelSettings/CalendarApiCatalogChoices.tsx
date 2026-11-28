import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { ApiCatalogAccount } from '../providers/selection/ApiCatalogAccount';
import { providerSettingsStyles as styles } from '../layout/providerSettingsPresentation';
import { t } from '../i18n';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../providers/selection/types';
import ProviderSelectionOptionCard from '../providers/selection/ProviderSelectionOptionCard';
import {
  calendarDecisionsBadge,
  calendarDecisionsModelLabel,
} from './calendarDecisionsPresentation';

export const calendarModelRequirements = { inputTypes: ['text'] } as const;

/** A cached row can display its saved checkmark without being selectable. */
export function CalendarApiCatalogChoices({
  connected,
  busy,
  disabled,
  rowStart,
  displayed,
  fresh,
  selected,
  refresh,
  choose,
  onOpenAccounts,
}: {
  connected: boolean;
  busy: boolean;
  disabled: boolean;
  rowStart: number;
  displayed: readonly ProviderSelectionOption[];
  fresh: readonly ProviderSelectionOption[];
  selected?: ProviderSelection | null;
  refresh(): void;
  choose(option: ProviderSelectionOption): void;
  onOpenAccounts?: () => void;
}) {
  return (
    <View style={styles.section} testID="calendar-model-group-openai-api">
      <Text accessibilityRole="header" style={styles.heading}>
        OpenAI API
      </Text>
      <View style={styles.catalogAccount}>
        <ApiCatalogAccount
          {...{ connected, busy, refresh, onOpenAccounts }}
          refreshLabel={t('modelSettings.refreshModels')}
          testIDPrefix="calendar"
          titleBadge={calendarDecisionsBadge}
        />
        {displayed.map((option, index) => (
          <ProviderSelectionOptionCard
            key={option.modelId}
            option={{ ...option, displayName: calendarDecisionsModelLabel }}
            index={rowStart + index}
            disabled={disabled || !fresh.includes(option)}
            requirements={calendarModelRequirements}
            selected={
              selected?.modelId === option.modelId &&
              selected.providerId === option.provider.id
            }
            onPress={() => {
              if (!disabled && fresh.includes(option)) choose(option);
            }}
          />
        ))}
      </View>
    </View>
  );
}
