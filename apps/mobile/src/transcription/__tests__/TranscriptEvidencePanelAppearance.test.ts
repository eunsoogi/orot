import { appColors } from '../../layout/appColors';
import { transcriptEvidenceStyles } from '../TranscriptEvidencePanel.styles';

test('uses appearance-aware colors for transcript content and editing surfaces', () => {
  expect(transcriptEvidenceStyles.segment.borderColor).toBe(appColors.border);
  expect(transcriptEvidenceStyles.segment.backgroundColor).toBe(
    appColors.surface,
  );
  expect(transcriptEvidenceStyles.audioCard.backgroundColor).toBe(
    appColors.surface,
  );
  expect(transcriptEvidenceStyles.title.color).toBe(appColors.text);
  expect(transcriptEvidenceStyles.copy.color).toBe(appColors.secondary);
  expect(transcriptEvidenceStyles.textBubble.color).toBe(appColors.text);
  expect(transcriptEvidenceStyles.origin.color).toBe(appColors.secondary);
  expect(transcriptEvidenceStyles.input.color).toBe(appColors.text);
  expect(transcriptEvidenceStyles.input.borderColor).toBe(appColors.primary);
  expect(transcriptEvidenceStyles.history.color).toBe(appColors.secondary);
  expect(transcriptEvidenceStyles.error.color).toBe(appColors.danger);
  expect(transcriptEvidenceStyles.summary.backgroundColor).toBe(
    appColors.surface,
  );
  expect(transcriptEvidenceStyles.editor.backgroundColor).toBe(
    appColors.primarySoft,
  );
  expect(transcriptEvidenceStyles.title.fontSize).toBe(30);
});
