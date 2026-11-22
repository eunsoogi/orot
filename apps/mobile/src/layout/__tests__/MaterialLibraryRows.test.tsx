import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { AppState, Dimensions, StyleSheet } from 'react-native';
import { SavedMemoryBrowser } from '../../memory/SavedMemoryBrowser';
import { GeneratedReportBrowser } from '../../generatedReports/GeneratedReportBrowser';
import type { GeneratedReportRow } from '../../generatedReports/types';
import { appColorPalettes, appColors } from '../appColors';

jest.mock('../../generatedReports/readers', () => ({
  openGeneratedReportReader: jest.fn(),
}));

const saved = (id: string) => ({
  id,
  text: `합성 기억 ${id}`,
  kind: 'preference' as const,
  createdAt: 1000,
  provenance: { sourceIds: [], reviewState: 'user_confirmed' as const },
});

const report = (id: string): GeneratedReportRow => ({
  key: id,
  id,
  kind: 'health_summary',
  origin: 'summary',
  createdAt: '2026-01-01T00:00:00Z',
  unavailable: false,
});

const original = {
  window: Dimensions.get('window'),
  screen: Dimensions.get('screen'),
};
beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});
afterEach(async () => {
  await act(async () => Dimensions.set(original));
});

function hasDecorativeChevron(
  node: ReturnType<typeof screen.getByTestId>,
): boolean {
  return (
    (node.props.symbolName === 'chevron.right' &&
      node.props.accessibilityElementsHidden === true) ||
    node.children.some(
      child => typeof child !== 'string' && hasDecorativeChevron(child),
    )
  );
}

test.each([
  { width: 390, scheme: 'dark', fontScale: 1.6 },
  { width: 870, scheme: 'light', fontScale: 1 },
] as const)(
  'separates headings from compact library rows in $scheme at $width pt',
  async ({ width, scheme, fontScale }) => {
    const dimensions = { width, height: 650, scale: 3, fontScale };
    await act(async () =>
      Dimensions.set({ window: dimensions, screen: dimensions }),
    );
    const openMemory = jest.fn();
    const load = async () => [saved('one'), saved('two')];
    const read = jest.fn(async () => ({ paragraphs: ['합성 보호 자료 원문'] }));
    const list = jest.fn(async () => [report('one'), report('two')]);
    await render(
      <>
        <SavedMemoryBrowser load={load} onOpenMemory={openMemory} />
        <GeneratedReportBrowser
          destination
          open={async () => ({ list, read })}
        />
      </>,
    );
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByText('합성 보호 자료 원문')).toBeNull();
    for (const [frameID, groupID, rowPrefix] of [
      ['saved-memory-browser', 'saved-memory-rows', 'saved-memory-entry-'],
      [
        'generated-report-browser',
        'generated-report-rows',
        'generated-report-',
      ],
    ] as const) {
      const frame = screen.getByTestId(frameID);
      const group = screen.getByTestId(groupID);
      expect(within(frame).getByRole('header')).toBeVisible();
      expect(within(group).queryByRole('header')).toBeNull();
      expect(frame).toHaveStyle({ paddingHorizontal: 20, paddingTop: 24 });
      expect(
        StyleSheet.flatten(frame.props.style).backgroundColor,
      ).toBeUndefined();
      expect(group).toHaveStyle({ backgroundColor: appColors.surface });
      expect(appColors.surface).toMatchObject({
        dynamic: { [scheme]: appColorPalettes[scheme].surface },
      });
      const first = screen.getByTestId(rowPrefix + 'one');
      const last = screen.getByTestId(rowPrefix + 'two');
      expect(first).toHaveStyle({
        minHeight: 44,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: appColors.border,
      });
      expect(last).not.toHaveStyle({
        borderBottomWidth: StyleSheet.hairlineWidth,
      });
      expect(within(group).getAllByRole('button')).toHaveLength(2);
      expect(hasDecorativeChevron(first)).toBe(true);
    }
    await fireEvent.press(screen.getByTestId('saved-memory-entry-one'));
    expect(openMemory).toHaveBeenCalledWith('one');
    expect(list).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('generated-report-one'));
    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.getByText('합성 보호 자료 원문')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('generated-report-back'));
    expect(screen.getByTestId('generated-report-rows')).toBeVisible();
    expect(screen.queryByText('합성 보호 자료 원문')).toBeNull();
  },
);
