import Foundation

/// Created only by native selected-recording admission. This value never represents
/// permission by itself and cannot be deserialized by ordinary response requests.
final class ProtectedEncounterTranscriptPage: @unchecked Sendable {
    let request: ChatGPTResponsesRequest
    let accountID: String
    let accountSubject: String
    private let lock = NSLock()
    private var consumed = false

    init(request: ChatGPTResponsesRequest, accountID: String, accountSubject: String, selectedModel: String) throws {
        guard !accountID.isEmpty, !accountSubject.isEmpty, !selectedModel.isEmpty,
              request.model == selectedModel, request.tools.isEmpty, request.toolChoice == nil,
              request.publicWebQuery == nil, request.transportScope == nil
        else { throw ChatGPTResponsesError.invalidRequest }

        var system = 0
        var users = 0
        for message in request.messages {
            switch message {
            case let .system(text) where !text.isEmpty && users == 0: system += 1
            case let .user(text) where !text.isEmpty: users += 1
            default: throw ChatGPTResponsesError.invalidRequest
            }
        }
        // One trusted instruction and the current page, plus optional stock structured guidance.
        guard system == 1, (1 ... 2).contains(users) else { throw ChatGPTResponsesError.invalidRequest }
        self.request = request
        self.accountID = accountID
        self.accountSubject = accountSubject
    }

    /// Burn before the first await, including on cancellation or uncertain failure.
    func claim(accountID: String, accountSubject: String) -> Bool {
        guard self.accountID == accountID, self.accountSubject == accountSubject else { return false }
        return lock.withLock {
            guard !consumed else { return false }
            consumed = true
            return true
        }
    }
}
