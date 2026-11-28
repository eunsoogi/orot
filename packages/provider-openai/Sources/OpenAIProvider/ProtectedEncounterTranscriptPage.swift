import Foundation

/// Created only by native selected-recording admission. This value never represents
/// permission by itself and cannot be deserialized by ordinary response requests.
final class ProtectedEncounterTranscriptPage: @unchecked Sendable {
    let request: ChatGPTResponsesRequest
    let accountID: String
    let accountSubject: String
    private let lock = NSLock()
    private var consumed = false

    convenience init(request: ChatGPTResponsesRequest, accountID: String, accountSubject: String, selectedModel: String) throws {
        try self.init(request: request, accountID: accountID, accountSubject: accountSubject,
                      selectedModel: selectedModel, dedicatedWire: false)
    }

    private init(
        request: ChatGPTResponsesRequest, accountID: String, accountSubject: String,
        selectedModel: String, dedicatedWire: Bool,
    ) throws {
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
        guard system == 1, dedicatedWire ? users == 3 : (1 ... 2).contains(users) else { throw ChatGPTResponsesError.invalidRequest }
        self.request = request
        self.accountID = accountID
        self.accountSubject = accountSubject
    }

    /// Future dedicated native application code passes exactly one role-tagged
    /// value after independently proving the authorized request and account.
    /// This carries no grant and is not the ordinary NSDictionary decoder.
    struct Wire {
        let instruction: String
        let transcript: String
        let citations: String
        let schema: String
    }

    convenience init(wire: Wire, accountID: String, accountSubject: String, selectedModel: String) throws {
        let fields = [wire.instruction, wire.transcript, wire.citations, wire.schema]
        guard fields.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        else { throw ChatGPTResponsesError.invalidRequest }
        try self.init(
            request: .init(model: selectedModel, messages: [
                .system(wire.instruction), .user(wire.transcript), .user(wire.citations), .user(wire.schema),
            ]),
            accountID: accountID, accountSubject: accountSubject, selectedModel: selectedModel,
            dedicatedWire: true,
        )
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
