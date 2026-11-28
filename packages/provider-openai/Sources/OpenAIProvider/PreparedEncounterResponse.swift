import Foundation

/// A native-only result owner. No ordinary React module exports creation or submission.
@_spi(SelectedEncounterNative)
public final class PreparedEncounterResponse: @unchecked Sendable {
    private let http: SuspendedEncounterHTTP
    private let result: @Sendable () async throws -> ChatGPTResponsesResult
    private let lock = NSLock()
    private var terminalClaimed = false

    init(http: SuspendedEncounterHTTP, result: @escaping @Sendable () async throws -> ChatGPTResponsesResult) {
        self.http = http
        self.result = result
    }

    @MainActor
    public func admitAndResume(admitted: () -> Bool) -> Bool {
        guard admitted() else {
            http.cancel()
            return false
        }
        return http.resumeOnce()
    }

    public func cancel() {
        http.cancel()
    }

    public func completedText() async throws -> String {
        try await terminal().text
    }

    func terminal() async throws -> ChatGPTResponsesResult {
        guard lock.withLock({ () -> Bool in
            guard !terminalClaimed else { return false }
            terminalClaimed = true
            return true
        }) else { throw ChatGPTResponsesError.invalidRequest }
        defer { http.cancel() }
        return try await withTaskCancellationHandler(operation: result, onCancel: { [http] in http.cancel() })
    }
}
