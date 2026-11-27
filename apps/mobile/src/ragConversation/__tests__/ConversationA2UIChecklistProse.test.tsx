import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationA2UILocalDraftOwner } from '../conversationA2UILocalDraftOwner';
import { ConversationA2UISurface } from '../ConversationA2UISurface';
import { conversationA2UICatalog } from '../conversationA2UI';
import { matchesConversationA2UIChecklist } from '../conversationA2UIChecklistProse';
import { projectConversationA2UIComposedControls } from '../conversationA2UIComposedControlFrames';
import { bindConversationA2UIComposedControls } from '../conversationA2UIComposedControlState';
import { acceptConversationA2UIFrameSequence } from '../conversationA2UIFrameSequence';
import { draftA2UISurfaceId } from '../conversationA2UIPresentation';

const ordinary = 'Alpha\nChoose a page\nBeta\nBottle';
const checklist = 'Alpha\n☐ Notebook\nChoose a page\nBeta\nBottle';
const raw = [
  JSON.stringify({
    version: '1.0',
    createSurface: {
      surfaceId: draftA2UISurfaceId,
      catalogId: conversationA2UICatalog,
      components: [
        {
          id: 'root',
          component: 'Tabs',
          tabs: [
            { title: 'Alpha', child: 'alpha' },
            { title: 'Beta', child: 'beta' },
          ],
        },
        { id: 'alpha', component: 'Column', children: ['check', 'tip'] },
        {
          id: 'check',
          component: 'CheckBox',
          label: 'Notebook',
          value: { '@path': '/local/notebook' },
        },
        { id: 'tip', component: 'Text', text: 'Choose a page' },
        { id: 'beta', component: 'Text', text: 'Bottle' },
      ],
    },
  }),
];

function fixture() {
  const plan = projectConversationA2UIComposedControls(
    raw,
    true,
    true,
    true,
    true,
  );
  if (!plan) throw new Error('Expected the stock local checkbox projection.');
  const admit = (answer: string) =>
    acceptConversationA2UIFrameSequence(
      plan.frames,
      answer,
      true,
      true,
      true,
      'cross_align',
    );
  // Isolate graph admission from the proposed text extension. The ordinary
  // fixture has no line for the checkbox slot; production never drops a line.
  const root = admit(ordinary);
  if (!root)
    throw new Error('Expected a validated graph with a local checkbox slot.');
  expect(admit(checklist)).toBeUndefined();
  return { root, controls: plan.controls };
}

test('opt-in checklist makes one owned local switch serve one exact fallback line', async () => {
  const { root, controls } = fixture();
  expect(matchesConversationA2UIChecklist(root, checklist, controls)).toBe(
    true,
  );
  expect(bindConversationA2UIComposedControls(root, controls)).toBe(true);
  await render(
    <ConversationA2UILocalDraftOwner.Provider
      value={{
        surface: candidate =>
          candidate === root ? 'synthetic:checklist' : undefined,
        subscribe: () => () => {},
      }}
    >
      <ConversationA2UISurface root={root} />
    </ConversationA2UILocalDraftOwner.Provider>,
  );
  expect(screen.getAllByText('Notebook')).toHaveLength(1);
  const toggle = screen.getByLabelText('Notebook');
  expect(toggle).toHaveProp('value', false);
  await fireEvent(toggle, 'valueChange', true);
  expect(toggle).toHaveProp('value', true);
  await fireEvent.press(screen.getByRole('tab', { name: 'Beta' }));
  expect(screen.queryByText('Notebook')).toBeNull();
  expect(screen.getByText('Bottle')).toBeTruthy();
});

test.each([
  ordinary,
  checklist.replace('☐ Notebook', 'Notebook'),
  checklist.replace('☐ Notebook', '☑ Notebook'),
  checklist.replace('☐ Notebook', '☐ notebook'),
  checklist.replace('☐ Notebook', '☐  Notebook'),
  checklist.replace('☐ Notebook', '- Notebook'),
  checklist.replace('Alpha', '## Alpha'),
  checklist.replace('☐ Notebook\nChoose a page', 'Choose a page\n☐ Notebook'),
  checklist.replace('☐ Notebook', '☐ Notebook\n☐ Notebook'),
  checklist.replace('Choose a page', 'https://example.invalid'),
])('does not normalize or silently accept a mismatching line', fallback => {
  const { root, controls } = fixture();
  expect(matchesConversationA2UIChecklist(root, fallback, controls)).toBe(
    false,
  );
});

test.each(['- [ ] ', '+ [ ] ', '* [ ] '])(
  'native checklist admits the unchanged Markdown marker %s only when enabled',
  prefix => {
    const { root, controls } = fixture();
    const fallback = checklist.replace('☐ ', prefix);
    expect(matchesConversationA2UIChecklist(root, fallback, controls)).toBe(
      false,
    );
    expect(
      matchesConversationA2UIChecklist(root, fallback, controls, true, true),
    ).toBe(true);
  },
);

test.each([
  '- [x] Notebook',
  '- [ ] notebook',
  '- [ ] **Notebook**',
  '- [ ] [Notebook](https://example.invalid)',
  '- [ ]  Notebook',
  '- [ ] Notebook\n- [ ] Notebook',
  '☐ Notebook\n- [ ] Choose a page',
])(
  'never normalizes a checked, conflicting or non-control Markdown line',
  replacement => {
    const { root, controls } = fixture();
    expect(
      matchesConversationA2UIChecklist(
        root,
        checklist.replace('☐ Notebook', replacement),
        controls,
        true,
        true,
      ),
    ).toBe(false);
  },
);
