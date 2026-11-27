import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';
import { EncounterReviewActions } from '../../encounterReview/EncounterReviewActions';
import { t } from '../../i18n';
import { generateRecordingTitle } from '../recordingTitleGeneration';
import { useRecordingTitleProposal } from '../useRecordingTitleProposal';

jest.mock('../recordingTitleGeneration', () => ({
  generateRecordingTitle: jest.fn(),
}));

test.each(['save', 'retire'] as const)(
  'only an explicit AI menu choice starts a title and a current draft can be saved: %s',
  async scenario => {
    let active = true;
    const listeners = new Set<() => void>();
    const owner = {
      isCurrent: () => active,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const generation = new AbortController();
    const save = jest.fn(async () => {
      generation.abort();
      return true;
    });
    const model = jest.mocked(generateRecordingTitle);
    model.mockReset();
    model.mockResolvedValue({
      title: '운동 상담',
      signal: generation.signal,
      save,
      discard: () => generation.abort(),
    });
    const saved = jest.fn();
    const analyze = jest.fn();
    const show = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => {});
    try {
      function Harness() {
        const action = useRecordingTitleProposal(
          'synthetic-source',
          owner,
          saved,
        );
        return (
          <>
            <EncounterReviewActions
              status="idle"
              hasPending={false}
              disabled={false}
              saveDisabled
              onStart={analyze}
              onSave={() => {}}
              onDeny={() => {}}
              onRestore={() => {}}
              onCancel={() => {}}
              titleAction={{
                sourceId: 'synthetic-source',
                owner,
                disabled: action.busy || action.draft,
                run: action.start,
              }}
            />
            {action.view}
          </>
        );
      }
      await render(<Harness />);
      expect(model).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('recording-analysis-menu'));
      const [menu, select] = show.mock.lastCall!;
      expect(model).not.toHaveBeenCalled();
      await act(async () =>
        select(menu.options.indexOf(t('recording.detail.aiTitle'))),
      );
      expect(
        await screen.findByTestId('recording-title-proposal'),
      ).toHaveTextContent('운동 상담');
      expect(analyze).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
      if (scenario === 'retire') {
        await act(async () => {
          active = false;
          listeners.forEach(listener => listener());
        });
        expect(screen.queryByTestId('recording-title-proposal')).toBeNull();
        expect(save).not.toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
        expect(model.mock.lastCall?.[1].aborted).toBe(true);
      } else {
        await fireEvent.press(screen.getByTestId('recording-title-save'));
        expect(save).toHaveBeenCalledTimes(1);
        expect(saved).toHaveBeenCalledWith('운동 상담');
      }
    } finally {
      show.mockRestore();
    }
  },
);
