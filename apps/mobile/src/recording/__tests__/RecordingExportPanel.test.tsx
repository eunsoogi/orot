import { fireEvent, render, screen } from '@testing-library/react-native';
import RecordingExportPanel from '../RecordingExportPanel';
import {
  correction,
  createServices,
  original,
  source,
} from '../recordingExportTestFixtures';

test('separates the two share options and explains their destination', async () => {
  const { transcriptService, exportService } = createServices([original]);
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  const audio = screen.getByTestId('recording-export-audio');
  const transcript = await screen.findByTestId('recording-export-transcript');
  expect(audio.props.accessibilityRole).toBe('button');
  expect(audio.props.accessibilityHint).toBe(
    '원본 음성 파일을 공유할 앱을 선택해요.',
  );
  expect(transcript.props.accessibilityHint).toBe(
    '최신 전사 내용을 공유할 앱을 선택해요.',
  );
  expect(screen.getByTestId('recording-export-privacy-note')).toHaveTextContent(
    '오디오 파일과 최신 전사 내용은 선택한 앱으로 공유돼요.',
  );
  expect(exportService.shareAudio).not.toHaveBeenCalled();
  expect(exportService.shareTranscript).not.toHaveBeenCalled();
});

test('exports the current transcript revision only after an explicit press', async () => {
  const { transcriptService, exportService } = createServices([
    original,
    correction,
  ]);
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  const button = await screen.findByTestId('recording-export-transcript');
  expect(exportService.shareTranscript).not.toHaveBeenCalled();
  await fireEvent.press(button);

  expect(exportService.shareTranscript).toHaveBeenCalledWith(
    expect.stringContaining('최신 사용자 수정'),
  );
  expect(exportService.shareTranscript).toHaveBeenCalledWith(
    expect.not.stringContaining('원문 전사'),
  );
  expect(
    await screen.findByTestId('recording-export-status'),
  ).toHaveTextContent('파일을 공유하거나 저장했어요.');
});

test('keeps empty transcript export actionable and reports that no content exists', async () => {
  const { transcriptService, exportService } = createServices([]);
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  expect(
    await screen.findByText('아직 내보낼 전사 내용이 없어요.'),
  ).toBeTruthy();
  const button = screen.getByTestId('recording-export-transcript');
  expect(button).toBeEnabled();
  await fireEvent.press(button);
  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '저장된 전사 내용이 없어요.',
  );
  expect(exportService.shareTranscript).not.toHaveBeenCalled();
});

test('refreshes after transcript text appears following the initial empty read', async () => {
  const { transcriptService, exportService } = createServices([]);
  transcriptService.load = jest
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      source,
      segments: [original],
      staleArtifacts: [],
    });

  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  // The exporter and transcript creator mount together before any text exists.
  const button = await screen.findByTestId('recording-export-transcript');
  expect(button).toBeEnabled();
  await fireEvent.press(button);

  expect(transcriptService.load).toHaveBeenCalledTimes(2);
  expect(exportService.shareTranscript).toHaveBeenCalledWith(
    expect.stringContaining('원문 전사'),
  );
  expect(
    await screen.findByTestId('recording-export-status'),
  ).toHaveTextContent('파일을 공유하거나 저장했어요.');
});

test('keeps audio export available when transcript lookup fails', async () => {
  const { transcriptService, exportService } = createServices([original]);
  transcriptService.load = jest.fn(async () => {
    throw new Error('transcript storage unavailable');
  });
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '전사 정보를 불러오지 못했어요.',
  );
  await fireEvent.press(screen.getByTestId('recording-export-audio'));
  expect(exportService.shareAudio).toHaveBeenCalledWith(source.id);
  expect(
    await screen.findByTestId('recording-export-status'),
  ).toHaveTextContent('파일을 공유하거나 저장했어요.');
});

test('distinguishes cancellation from a missing original recording file', async () => {
  const { transcriptService, exportService } = createServices([original]);
  exportService.shareAudio = jest.fn(async () => 'cancelled');
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  await fireEvent.press(await screen.findByTestId('recording-export-audio'));
  expect(
    await screen.findByTestId('recording-export-status'),
  ).toHaveTextContent('내보내기를 취소했어요.');

  exportService.shareAudio = jest.fn(async () => {
    throw Object.assign(new Error('missing source'), {
      code: 'RECORDING_EXPORT_SOURCE_MISSING',
    });
  });
  await fireEvent.press(screen.getByTestId('recording-export-audio'));
  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '녹음 원본 파일을 찾을 수 없어요.',
  );
});

test('reports an iOS activity failure without claiming export success', async () => {
  const { transcriptService, exportService } = createServices([original]);
  exportService.shareTranscript = jest.fn(async () => {
    throw Object.assign(new Error('activity failed'), {
      code: 'RECORDING_EXPORT_FAILED',
    });
  });
  await render(
    <RecordingExportPanel
      recordingSourceId={source.id}
      transcriptService={transcriptService}
      exportService={exportService}
    />,
  );

  await fireEvent.press(
    await screen.findByTestId('recording-export-transcript'),
  );
  expect(await screen.findByTestId('recording-export-error')).toHaveTextContent(
    '파일을 내보내지 못했어요. 다시 시도해 주세요.',
  );
  expect(screen.queryByTestId('recording-export-status')).toBeNull();
});
