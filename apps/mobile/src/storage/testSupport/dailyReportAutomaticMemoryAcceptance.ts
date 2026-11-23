import { captureDailyReportMemoryTap } from '../dailyReportMemoryTap';
import type { createConversationArtifactStorage } from '../conversationArtifactStorage';
import type { ConversationArtifact } from '../conversationArtifactCodec';

type Conversations = ReturnType<typeof createConversationArtifactStorage>;

export async function expectAutomaticReportReference(
  conversations: Conversations,
  historical: ConversationArtifact,
  second: NonNullable<ConversationArtifact['dailyReport']>,
  loseDeviceAuthority: () => void,
) {
  const fresh = {
    ...historical,
    id: 'fresh-user-request',
    dailyReport: second,
    createdAt: '2035-01-01T12:05:00.000Z',
  };
  const live = () => true;
  const owner = {
    artifactId: fresh.id,
    lease: { id: fresh.sessionId, version: 0 },
  };
  const save = (token: object, current = live) =>
    conversations.bookmarkCompletedDailyReport(
      { ...owner, current },
      { token, runId: second.runId, revision: second.revision },
    );

  expect(await conversations.readAutomaticDailyReportMemory()).toBe(false);
  expect(captureDailyReportMemoryTap()).toBeUndefined();
  expect(await conversations.changeAutomaticDailyReportMemory(true, live)).toBe(
    true,
  );
  const admit = async () => {
    expect(await conversations.readAutomaticDailyReportMemory()).toBe(true);
    const tap = captureDailyReportMemoryTap();
    if (!tap) throw new Error('Synthetic permission observation rejected');
    const token = conversations.admitAutomaticDailyReportMemory(owner, tap);
    if (!token) throw new Error('Synthetic live admission rejected');
    return token;
  };
  const fromOtherDevice = await admit();
  loseDeviceAuthority();
  expect(await conversations.readAutomaticDailyReportMemory()).toBe(false);
  expect(captureDailyReportMemoryTap()).toBeUndefined();
  expect(await conversations.changeAutomaticDailyReportMemory(true, live)).toBe(
    true,
  );
  const beforeCommit = await admit();
  expect(await save(beforeCommit)).toBe(false);
  const revoked = await admit();
  expect(
    await conversations.changeAutomaticDailyReportMemory(false, live),
  ).toBe(true);
  expect(await conversations.changeAutomaticDailyReportMemory(true, live)).toBe(
    true,
  );
  const accepted = await admit();
  const wrongRevision = await admit();
  await conversations.startRequest({
    id: fresh.id,
    sessionId: fresh.sessionId,
    sessionVersion: 0,
    question: fresh.question,
    createdAt: fresh.createdAt,
  });
  await conversations.append(fresh);
  expect(await save(revoked)).toBe(false);
  expect(await save(fromOtherDevice)).toBe(false);
  expect(
    await conversations.bookmarkCompletedDailyReport(
      { ...owner, current: live },
      {
        token: wrongRevision,
        runId: second.runId,
        revision: second.revision + 1,
      },
    ),
  ).toBe(false);
  expect(await conversations.listSavedGeneratedReportReferences()).toHaveLength(
    1,
  );
  expect(await save(accepted)).toBe(true);
  expect(await save(accepted)).toBe(false);
  expect(await conversations.listSavedGeneratedReportReferences()).toHaveLength(
    2,
  );
  expect(
    await conversations.readSavedGeneratedReportReference(fresh.id, live),
  ).toMatchObject({ report: { observations: [{ text: 'Revised report' }] } });
  expect(
    await conversations.changeAutomaticDailyReportMemory(false, live),
  ).toBe(true);
  // Disable stops future automatic additions without touching past pointers or report history.
  expect(await conversations.listSavedGeneratedReportReferences()).toHaveLength(
    2,
  );
}
