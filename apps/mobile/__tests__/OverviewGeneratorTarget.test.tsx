import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  enterOverviewGenerator,
  futureOverviewVisit,
  generateHomeDraft,
  renderOverviewGenerator,
} from '../test-helpers/overviewGeneratorHarness';
import { nextVisitQuestionsCopy as copy } from '../src/nextVisitQuestions/copy';

import { resolveSettingsConsentOwner } from '../src/agent/execution/settingsConsentOwner';
import { settingsConsentRepository } from '../src/storage/settingsConsentRepository';
import { settingsPermissionsForFeature } from '../src/agent/execution/settingsConsentCatalog';
import { visitConsentScope } from '../src/agent/execution/inferenceConsentScopes';
import { createAppleSelectionOption } from '../src/providers/selection/options';
jest.mock('../src/agent/execution/settingsConsentOwner', () => ({
  resolveSettingsConsentOwner: jest.fn(),
}));
jest.mock('../src/storage/settingsConsentRepository', () => ({
  settingsConsentRepository: jest.fn(),
}));
afterEach(() => jest.restoreAllMocks());

function settingsApproval(approved: boolean) {
  const option = createAppleSelectionOption('available');
  const identity = {
    providerId: option.provider.id,
    modelId: option.modelId,
    recipient: '합성 처리 대상',
    authorityGeneration: 'synthetic-generation',
    credentialEpoch: 'synthetic-credential',
  };
  jest.mocked(resolveSettingsConsentOwner).mockResolvedValue({
    slot: 'conversation',
    domain: 'model',
    identity,
    isCurrent: () => true,
  });
  jest.mocked(settingsConsentRepository).mockResolvedValue({
    read: jest.fn(async () =>
      approved
        ? {
            version: 1,
            catalogVersion: 'model-settings-v1',
            identity,
            permissions: settingsPermissionsForFeature('conversation'),
          }
        : null,
    ),
  } as never);
}

test('the retained Home A editor uses settings consent without a modal and saves its reviewed questions', async () => {
  settingsApproval(true);
  const { generate, save } = await renderOverviewGenerator(
    undefined,
    true,
    true,
  );
  // The old synthetic generator predated declared settings scopes. Preserve its
  // actual confirmConsent call and payload, adding the production visit boundary.
  const originalGenerate = generate.getMockImplementation()!;
  generate.mockImplementation(input =>
    originalGenerate({
      ...input,
      confirmConsent: request =>
        input.confirmConsent({ ...request, consentScope: visitConsentScope }),
    }),
  );
  await enterOverviewGenerator(true);
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull();
  expect(save).not.toHaveBeenCalled();
  const input = await screen.findByTestId('next-visit-question-text-0');
  await fireEvent.changeText(input, 'Home A: 직접 수정한 질문');
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(generate.mock.calls[0]?.[0].appointment.id).toBe('Home A');
  expect(save.mock.calls[0]?.[0].appointment.id).toBe('Home A');
  expect(save.mock.calls[0]?.[0].questions[0]?.questionText).toBe(
    'Home A: 직접 수정한 질문',
  );
});

test('an entry lookup changing from displayed A to future B never exposes B or allows generation', async () => {
  const { store, query, generate, save } = await renderOverviewGenerator(
    undefined,
    false,
    true,
  );
  await store.repository.cancel('Home A');
  query.mockResolvedValue(futureOverviewVisit('Calendar B'));
  await fireEvent.press(
    await screen.findByTestId('retained-visit-module-open'),
  );
  expect(await screen.findByText(copy.appointment.none)).toBeTruthy();
  expect(screen.queryByText('Calendar B')).toBeNull();
  expect(generate).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

test('a target change immediately before generation is rejected before model or consent work', async () => {
  const { store, query, generate } = await renderOverviewGenerator(
    undefined,
    false,
    true,
  );
  await enterOverviewGenerator(true);
  await store.repository.cancel('Home A');
  query.mockResolvedValue(futureOverviewVisit('Calendar B'));
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(await screen.findByText(copy.appointment.none)).toBeTruthy();
  expect(generate).not.toHaveBeenCalled();
  expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull();
});

test('reviewed A cannot be saved after the current query changes to B', async () => {
  const { query, save } = await renderOverviewGenerator(undefined, false, true);
  await enterOverviewGenerator(true);
  await generateHomeDraft();
  query.mockResolvedValue(futureOverviewVisit('Calendar B'));
  await fireEvent.press(screen.getByTestId('next-visit-review-save'));
  expect(
    await screen.findByText(
      '예약이나 원문 근거가 바뀌어 저장하지 못했어요. 최신 내용을 확인해 주세요.',
    ),
  ).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByTestId('next-visit-question-text-0')).toBeTruthy();
});

test('a retained editor without settings approval neither presents a chat prompt nor creates or saves questions', async () => {
  settingsApproval(false);
  const { generate, save } = await renderOverviewGenerator(
    undefined,
    true,
    true,
  );
  const originalGenerate = generate.getMockImplementation()!;
  generate.mockImplementation(input =>
    originalGenerate({
      ...input,
      confirmConsent: request =>
        input.confirmConsent({ ...request, consentScope: visitConsentScope }),
    }),
  );
  await enterOverviewGenerator(true);
  await fireEvent.press(screen.getByTestId('next-visit-generate'));
  expect(await screen.findByText('동의가 필요해요.')).toBeTruthy();
  expect(screen.queryByTestId('inference-disclosure-sheet')).toBeNull();
  expect(screen.queryByTestId('next-visit-question-text-0')).toBeNull();
  expect(save).not.toHaveBeenCalled();
});
