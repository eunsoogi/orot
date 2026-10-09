import { openLocalAgentMemory } from '../../../memory/localAgentMemory';
import { openLocalE5RagService } from '../../../rag/localE5RagService';
import { openLocalRecordQueryService } from '../../localRecordQuery';
import { prepareVisitQuestionContext } from '../evidenceService';
import { loadSecureDatabaseModule } from '../secureDatabaseLoader';
import {
  generateUpcomingVisitQuestionRecommendations,
  prepareUpcomingVisitQuestionContext,
} from '../localContext';
import { runVisitQuestionWorkflow } from '../workflow';

jest.mock('../../../memory/localAgentMemory', () => ({
  openLocalAgentMemory: jest.fn(),
}));
jest.mock('../../../rag/localE5EmbeddingProvider', () => ({
  LocalE5EmbeddingProvider: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../rag/localE5NativeBackend', () => ({
  localE5NativeBackend: {},
}));
jest.mock('../../../rag/localE5RagService', () => ({
  openLocalE5RagService: jest.fn(),
}));
jest.mock('../../localRecordQuery', () => ({
  openLocalRecordQueryService: jest.fn(),
}));
jest.mock('../secureDatabaseLoader', () => ({
  loadSecureDatabaseModule: jest.fn(),
}));
jest.mock('../persistence', () => ({
  saveReviewedVisitQuestions: jest.fn(),
}));
jest.mock('../workflow', () => ({
  runVisitQuestionWorkflow: jest.fn(),
}));
jest.mock('../evidenceService', () => ({
  prepareVisitQuestionContext: jest.fn(),
}));

describe('visit-question generation cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards the caller signal into initial local context preparation', async () => {
    const repository = {};
    const rag = {};
    const memory = {};
    const queryService = {};
    const signal = new AbortController().signal;
    jest.mocked(loadSecureDatabaseModule).mockResolvedValue({
      openLocalStorage: jest.fn().mockResolvedValue(repository),
    } as never);
    jest.mocked(openLocalE5RagService).mockResolvedValue(rag as never);
    jest.mocked(openLocalAgentMemory).mockResolvedValue(memory as never);
    jest
      .mocked(openLocalRecordQueryService)
      .mockResolvedValue(queryService as never);
    jest.mocked(prepareVisitQuestionContext).mockResolvedValue({
      status: 'cancelled',
    });

    const result = await generateUpcomingVisitQuestionRecommendations({
      now: '2026-10-07T04:00:00.000Z',
      maxEvidenceItems: 8,
      selection: null,
      providerOptions: [],
      signal,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(prepareVisitQuestionContext).toHaveBeenCalledWith(
      expect.objectContaining({ signal }),
    );
    expect(runVisitQuestionWorkflow).not.toHaveBeenCalled();
  });

  it('does not open local sources when generation starts aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await generateUpcomingVisitQuestionRecommendations({
      now: '2026-10-07T04:00:00.000Z',
      maxEvidenceItems: 8,
      selection: null,
      providerOptions: [],
      signal: controller.signal,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(loadSecureDatabaseModule).not.toHaveBeenCalled();
    expect(openLocalE5RagService).not.toHaveBeenCalled();
  });

  it('stops opening further sources when storage finishes after cancellation', async () => {
    const controller = new AbortController();
    jest.mocked(openLocalE5RagService).mockResolvedValue({} as never);
    jest.mocked(loadSecureDatabaseModule).mockResolvedValue({
      openLocalStorage: jest.fn().mockImplementationOnce(async () => {
        controller.abort();
        return {} as never;
      }),
    } as never);

    const result = await prepareUpcomingVisitQuestionContext({
      now: '2026-10-07T04:00:00.000Z',
      maxEvidenceItems: 8,
      signal: controller.signal,
    });

    expect(result).toEqual({ status: 'cancelled' });
    expect(openLocalAgentMemory).not.toHaveBeenCalled();
    expect(openLocalRecordQueryService).not.toHaveBeenCalled();
    expect(prepareVisitQuestionContext).not.toHaveBeenCalled();
  });
});
