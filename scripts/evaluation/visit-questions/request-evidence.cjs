'use strict';

function parsedToolResult(message) {
  if (typeof message.result !== 'string') return message.result;
  try {
    return JSON.parse(message.result);
  } catch {
    return undefined;
  }
}

// Resolve only references actually returned by tools against the current task's
// evidence. Never fill missing records from the fixture or accept an unsearched
// user-message item as a tool result; runtime provenance validation stays intact.
function evidenceFromRequest(request) {
  const prefix = 'Available evidence: ';
  const line = request.messages
    .filter((message) => message.role === 'user' && typeof message.content === 'string')
    .flatMap((message) => message.content.split('\n'))
    .find((value) => value.startsWith(prefix));
  const current = line ? JSON.parse(line.slice(prefix.length)) : [];
  const items = Array.isArray(current) ? current : [];
  return request.messages.flatMap((message) => {
    if (message.role !== 'tool') return [];
    const result = parsedToolResult(message);
    if (Array.isArray(result?.items)) return result.items;
    if (result?.contentLocation !== 'current_task_messages' || !Array.isArray(result.evidenceIds)) {
      return [];
    }
    return result.evidenceIds.map((id) => {
      const matches = items.filter((item) => item.evidenceId === id);
      if (matches.length !== 1) {
        throw new Error('A tool evidence reference must resolve to one current task item.');
      }
      return matches[0];
    });
  });
}

module.exports = { parsedToolResult, evidenceFromRequest };
