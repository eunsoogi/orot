import Foundation

public extension ChatGPTOAuthClient {
    func streamResponse(
        _ request: ChatGPTResponsesRequest,
        for account: ChatGPTAccountAccess
    ) async throws -> AsyncThrowingStream<ChatGPTResponsesEvent, Error> {
        guard account.hasDirectPlanAccess else { throw ChatGPTOAuthError.planPermissionMissing }
        let stored = try await sessionManager.accountWithFreshAccessToken(issuedClientID: account.issuedClientID)
        try Task.checkCancellation()
        guard stored.subject == account.subject else { throw ChatGPTOAuthError.accountIdentityMismatch }
        guard stored.hasDirectPlanAccess else { throw ChatGPTOAuthError.planPermissionMissing }
        guard let accessToken = stored.credentials?.accessToken else { throw ChatGPTOAuthError.reauthorizationRequired }
        return try await openResponseStream(request, accessToken: accessToken)
    }

    func streamResponse(
        _ request: ChatGPTResponsesRequest,
        forIssuedClientID issuedClientID: String
    ) async throws -> AsyncThrowingStream<ChatGPTResponsesEvent, Error> {
        let stored = try await sessionManager.accountWithFreshAccessToken(issuedClientID: issuedClientID)
        try Task.checkCancellation()
        guard stored.hasDirectPlanAccess else { throw ChatGPTOAuthError.planPermissionMissing }
        guard let accessToken = stored.credentials?.accessToken else { throw ChatGPTOAuthError.reauthorizationRequired }
        return try await openResponseStream(request, accessToken: accessToken)
    }

    func generateResponse(
        _ request: ChatGPTResponsesRequest,
        for account: ChatGPTAccountAccess
    ) async throws -> ChatGPTResponsesResult {
        let events = try await streamResponse(request, for: account)
        for try await event in events {
            if case .completed(let response) = event { return response }
        }
        throw ChatGPTResponsesError.interrupted
    }

    func generateResponse(
        _ request: ChatGPTResponsesRequest,
        forIssuedClientID issuedClientID: String
    ) async throws -> ChatGPTResponsesResult {
        let events = try await streamResponse(request, forIssuedClientID: issuedClientID)
        for try await event in events {
            if case .completed(let response) = event { return response }
        }
        throw ChatGPTResponsesError.interrupted
    }

    private func openResponseStream(
        _ input: ChatGPTResponsesRequest,
        accessToken: String
    ) async throws -> AsyncThrowingStream<ChatGPTResponsesEvent, Error> {
        let request = try ChatGPTResponsesRequestBuilder.build(input, accessToken: accessToken)
        try Task.checkCancellation()

        let response: URLResponse
        let body: AsyncThrowingStream<Data, Error>
        do {
            (response, body) = try await responsesTransport.stream(for: request)
        } catch {
            if Self.isCancellation(error) { throw CancellationError() }
            throw ChatGPTResponsesError.transportUnavailable
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ChatGPTResponsesError.invalidHTTPResponse
        }
        let requestID = httpResponse.value(forHTTPHeaderField: "x-request-id")
        guard (200...299).contains(httpResponse.statusCode) else {
            let diagnostics = try await ResponsesHTTPFailureParser.diagnostics(
                for: body,
                statusCode: httpResponse.statusCode,
                requestID: requestID
            )
            throw ChatGPTResponsesError.httpFailure(diagnostics)
        }
        guard httpResponse.statusCode == 200 else { throw ChatGPTResponsesError.invalidHTTPResponse }
        guard httpResponse.value(forHTTPHeaderField: "content-type")?.lowercased().hasPrefix("text/event-stream") == true else {
            throw ChatGPTResponsesError.invalidContentType
        }

        return AsyncThrowingStream { continuation in
            let task = Task {
                var decoder = ResponsesSSEDecoder()
                var normalizer = ResponsesEventNormalizer(requestID: requestID)
                do {
                    for try await chunk in body {
                        try Task.checkCancellation()
                        for frame in try decoder.append(chunk) {
                            if let event = try normalizer.consume(frame) {
                                continuation.yield(event)
                                if case .completed = event {
                                    continuation.finish()
                                    return
                                }
                            }
                        }
                    }
                    _ = try decoder.finish()
                    guard normalizer.completed else { throw ChatGPTResponsesError.interrupted }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { @Sendable _ in task.cancel() }
        }
    }

    private static func isCancellation(_ error: Error) -> Bool {
        Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled
    }
}
