import Foundation

/// A role-bounded native input. It is not an approval receipt and has no
/// NSDictionary decoder or export through an ordinary response bridge.
@_spi(SelectedEncounterNative)
public struct ChatGPTSelectedEncounterPage: Sendable {
    fileprivate let accountID: String
    fileprivate let subject: String
    fileprivate let model: String
    fileprivate let instruction: String
    fileprivate let transcript: String
    fileprivate let citations: String
    fileprivate let schema: String

    public init(
        accountID: String,
        subject: String,
        model: String,
        instruction: String,
        transcript: String,
        citations: String,
        schema: String,
    ) {
        self.accountID = accountID
        self.subject = subject
        self.model = model
        self.instruction = instruction
        self.transcript = transcript
        self.citations = citations
        self.schema = schema
    }
}

public extension ChatGPTOAuthClient {
    /// Only the native app recording owner may call this with its durable
    /// source/consent proof. This never starts a Responses request.
    @_spi(SelectedEncounterNative)
    func prepareSelectedEncounterPage(
        _ selection: ChatGPTSelectedEncounterPage,
        admitted: @escaping @Sendable () async -> Bool,
    ) async throws -> PreparedEncounterResponse {
        let page = try ProtectedEncounterTranscriptPage(
            wire: .init(instruction: selection.instruction, transcript: selection.transcript,
                        citations: selection.citations, schema: selection.schema),
            accountID: selection.accountID, accountSubject: selection.subject, selectedModel: selection.model,
        )
        return try await prepareSuspendedEncounterPage(
            page, issuedClientID: selection.accountID, expectedSubject: selection.subject, admitted: admitted,
        )
    }
}
