import { NativeModules } from "react-native";
import { createLiveResponsesHealthToolExecutor } from "../liveResponsesHealthToolExecutor";
import { call, fixture } from "../testSupport/liveResponsesProtectedFixture";

test("confirmation precedes any SQLite read; one exact aggregate goes only to the same native challenge", async () => {
  const f = await fixture();
  try {
    let approvedOutput: string | undefined;
    const execute = createLiveResponsesHealthToolExecutor({
      ...f.input,
      async confirm(authority) {
        expect(f.read).not.toHaveBeenCalled();
        expect(authority.scope).toEqual({ topic: "measurements", days: 7 });
        expect(authority.owner.recipient).toBe("OpenAI Responses (Live)");
        return true;
      },
      async authorizeResult(authority, output) {
        expect(authority.call).toEqual(call);
        approvedOutput = output;
        return () => true;
      },
    });
    await execute(call, f.controller.signal);
    await execute(call, f.controller.signal);
    expect(f.settle).toHaveBeenCalledTimes(1);
    const output = f.settle.mock.calls[0]?.[2];
    expect(f.settle).toHaveBeenCalledWith(
      call.callId,
      call.challengeId,
      approvedOutput,
    );
    expect(output).not.toBeNull();
    expect(JSON.parse(output!)).toMatchObject({
      topic: "measurements",
      days: 7,
    });
    expect(JSON.parse(output!)).toEqual({
      topic: "measurements",
      metric: "heart_rate",
      unit: "count/min",
      days: 7,
      sampleCount: 3,
      meanOfRecordedDailyMeans: 72,
    });
    expect(output).not.toContain("synthetic-health-id");
    expect(f.read.mock.calls.length).toBeGreaterThan(1);
  } finally {
    f.close();
  }
});

test.each([
  "denied",
  "locked",
  "rotated",
  "source changed",
  "result revoked",
  "stopped",
  "replaced",
] as const)("%s cannot return any private output", async (scenario) => {
  const f = await fixture();
  try {
    const execute = createLiveResponsesHealthToolExecutor({
      ...f.input,
      confirm: async () => scenario !== "denied",
      async authorizeResult() {
        if (scenario === "locked") f.lock();
        if (scenario === "rotated") f.rotate();
        if (scenario === "source changed") await f.edit();
        if (scenario === "stopped") f.controller.abort();
        if (scenario === "replaced")
          f.setActive({ ...call, delegationId: "replacement" });
        return () => scenario !== "result revoked";
      },
    });
    await execute(call, f.controller.signal);
    if (scenario !== "stopped" && scenario !== "replaced")
      expect(f.settle).toHaveBeenCalledWith(
        call.callId,
        call.challengeId,
        null,
      );
    expect(f.settle.mock.calls.every(([, , output]) => output === null)).toBe(
      true,
    );
    if (scenario === "denied") expect(f.read).not.toHaveBeenCalled();
    else expect(f.read).toHaveBeenCalled();
    if (scenario === "replaced" || scenario === "stopped")
      expect(f.settle).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test.each([
  { topic: "measurements", days: 0 },
  { topic: "measurements", days: 32 },
  { topic: "measurements", days: 7, detail: "daily" },
  { topic: "documents", days: 7 },
  { topic: "symptoms", days: 7 },
  { topic: "medications", days: 7 },
  { topic: "measurements", days: 2 },
])("rejects unsupported scopes before local reads (%p)", async (args) => {
  const f = await fixture();
  try {
    const invalid = { ...call, args: JSON.stringify(args) };
    f.setActive(invalid);
    const confirm = jest.fn(async () => true);
    await createLiveResponsesHealthToolExecutor({ ...f.input, confirm })(
      invalid,
      f.controller.signal,
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.settle).toHaveBeenCalledWith(call.callId, call.challengeId, null);
  } finally {
    f.close();
  }
});

test("a reviewed-memory only Settings receipt cannot authorize health data", async () => {
  const f = await fixture();
  try {
    const confirm = jest.fn(async () => true);
    await createLiveResponsesHealthToolExecutor({
      ...f.input,
      confirm,
      async resolveOwner(event) {
        const saved = await f.input.resolveOwner(event);
        return {
          ...saved!,
          resultKind: "reviewed-memory",
        } as unknown as NonNullable<typeof saved>;
      },
    })(call, f.controller.signal);
    expect(confirm).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.settle).toHaveBeenCalledWith(call.callId, call.challengeId, null);
  } finally {
    f.close();
  }
});

test("the admitted health read uses the canonical adapter without constructing unrelated searches", async () => {
  const f = await fixture();
  try {
    const unrelatedRag = jest.fn(() => {
      throw new Error(
        "Unrelated search must not initialize for this managed call.",
      );
    });
    const execute = createLiveResponsesHealthToolExecutor({
      ...f.input,
      async openData() {
        const data = await f.input.openData();
        return Object.defineProperty(data, "rag", { get: unrelatedRag });
      },
    });
    await execute(call, f.controller.signal);
    expect(unrelatedRag).not.toHaveBeenCalled();
    expect(f.read).toHaveBeenCalled();
    expect(f.settle).toHaveBeenCalledTimes(1);
    const bytes = f.settle.mock.calls[0]?.[2];
    expect(bytes).not.toBeNull();
    expect(JSON.parse(bytes!)).toEqual({
      topic: "measurements",
      metric: "heart_rate",
      unit: "count/min",
      days: 7,
      sampleCount: 3,
      meanOfRecordedDailyMeans: 72,
    });
  } finally {
    f.close();
  }
});

test("opt-in trace separates protected health lookup, exact confirmation and native handoff without content", async () => {
  const f = await fixture();
  const report = jest.fn();
  const holder = NativeModules.OrotProviderDiagnostics;
  let milliseconds = 101;
  const clock = jest
    .spyOn(performance, "now")
    .mockImplementation(() => milliseconds);
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
  try {
    const execute = createLiveResponsesHealthToolExecutor({
      ...f.input,
      async confirm() {
        milliseconds += 20;
        return true;
      },
      async authorizeResult() {
        milliseconds += 157;
        return () => true;
      },
      async settle(...args) {
        milliseconds += 4;
        return f.input.settle(...args);
      },
    });
    await execute(call, f.controller.signal);
    expect(f.settle).toHaveBeenCalledTimes(1);
    expect(report.mock.calls).toEqual(
      expect.arrayContaining([
        ["live_health", "local_confirmation", "20"],
        ["live_health", "evidence_lookup", "0"],
        ["live_health", "result_projection", "0"],
        ["live_health", "result_confirmation", "157"],
        ["live_health", "source_reproof", "0"],
        ["live_health", "native_handoff", "4"],
      ]),
    );
    expect(report.mock.calls.every((args) => args.length === 3)).toBe(true);
    expect(JSON.stringify(report.mock.calls)).not.toContain(call.challengeId);
    expect(JSON.stringify(report.mock.calls)).not.toContain(
      "synthetic-health-id",
    );
  } finally {
    clock.mockRestore();
    NativeModules.OrotProviderDiagnostics = holder;
    f.close();
  }
});

test("one fresh settings receipt before local approval; later owner and source checks stay independent", async () => {
  const f = await fixture();
  const resolveOwner = jest.fn(f.input.resolveOwner);
  const protectedDataAvailable = jest.fn(f.input.protectedDataAvailable);
  let receiptReadsAtPrompt = 0;
  let checksAtPrompt = 0;
  try {
    await createLiveResponsesHealthToolExecutor({
      ...f.input,
      resolveOwner,
      protectedDataAvailable,
      confirm: async () => {
        receiptReadsAtPrompt = resolveOwner.mock.calls.length;
        checksAtPrompt = protectedDataAvailable.mock.calls.length;
        expect(f.read).not.toHaveBeenCalled();
        return true;
      },
    })(call, f.controller.signal);
    expect(receiptReadsAtPrompt).toBe(1);
    expect(checksAtPrompt).toBe(1);
    expect(resolveOwner).toHaveBeenCalledTimes(4);
    expect(protectedDataAvailable).toHaveBeenCalledTimes(4);
    expect(f.settle).toHaveBeenCalledTimes(1);
    expect(f.settle.mock.calls[0]?.[2]).not.toBeNull();
  } finally {
    f.close();
  }
});

test.each(["locked", "rotated"] as const)(
  "held first owner lookup revoked by %s cannot open approval or read health data",
  async (scenario) => {
    const f = await fixture();
    const confirm = jest.fn(f.input.confirm);
    try {
      await createLiveResponsesHealthToolExecutor({
        ...f.input,
        confirm,
        async resolveOwner(incoming) {
          const oldOwner = await f.input.resolveOwner(incoming);
          await Promise.resolve();
          if (scenario === "locked") f.lock();
          else f.rotate();
          return oldOwner;
        },
      })(call, f.controller.signal);
      expect(confirm).not.toHaveBeenCalled();
      expect(f.read).not.toHaveBeenCalled();
      expect(f.settle).toHaveBeenCalledWith(
        call.callId,
        call.challengeId,
        null,
      );
    } finally {
      f.close();
    }
  },
);
