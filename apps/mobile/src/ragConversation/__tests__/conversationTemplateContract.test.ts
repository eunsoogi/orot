import type { TaskResponderInput } from '@orot/agent-runtime';
import { ragConversationTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';
import {
  parseConversationReport,
  possibilityReportTemplate,
} from '../conversationReportTemplate';
import { t } from '../../i18n';

const input = {
  request: t('conversationIntent.possibilities'),
  context: { intent: 'possibilities' },
  evidence: { items: [], coverage: [], conflicts: [] },
} as unknown as TaskResponderInput;

test.each(['9', '10', '11', '13'])(
  'old task %s retains its original model input without new template guidance',
  taskVersion => {
    const task = restoreConversationTask({
      taskType: ragConversationTask.taskType,
      taskVersion,
    })!;
    const oldMessages = task.createMessages(input);
    const newMessages = ragConversationTask.createMessages(input);
    const previousMessage = oldMessages[0]!;
    const currentMessage = newMessages[0]!;
    if (previousMessage.role !== 'user' || currentMessage.role !== 'user')
      throw new Error('Expected task input messages');
    const previous = JSON.parse(previousMessage.content as string);
    const current = JSON.parse(currentMessage.content as string);
    expect(current.answerTemplate).toBeDefined();
    expect(previous).not.toHaveProperty('answerTemplate');
    delete current.answerTemplate;
    expect(previous).toEqual(current);
    expect(previousMessage.content).toBe(JSON.stringify(current));
    expect(task.taskVersion).toBe(taskVersion);
  },
);

test.each(['\n', '\n\n', '\n\n\n'])(
  'explicit report accepts ordinary Markdown title spacing %p without losing any body',
  spacing => {
    const template = possibilityReportTemplate();
    const bodies = template.sections.map((_, i) => `Synthetic ${i}`);
    const text = `# ${template.title}${spacing}${template.sections.map((title, i) => `## ${title}\n${bodies[i]}`).join('\n')}`;
    expect(
      parseConversationReport(text)?.sections.map(section => section.content),
    ).toEqual(bodies);
  },
);

test.each([
  'conversationTemplate.daily.scope',
  'dailyReport.coverage.attention',
] as const)(
  'renders the historical or current app-owned Daily Report heading %s',
  key => {
    const body = 'First retained line.\n\nSecond retained line.';
    const title = t(key);
    expect(
      parseConversationReport(
        `# ${t('dailyReport.title')}\n\nSynthetic cutoff.\n\n## ${title}\n\n${body}`,
      )?.sections,
    ).toEqual([{ title, content: `\n${body}` }]);
  },
);
