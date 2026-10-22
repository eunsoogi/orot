import Foundation

public extension ChatGPTOAuthClient {
    func streamResponse(
        _ request: ChatGPTResponsesRequest,
        for account: ChatGPTAccountAccess,
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
        forIssuedClientID issuedClientID: String,
    ) async throws -> AsyncThrowingStream<ChatGPTResponsesEvent, Error> {
        let stored = try await sessionManager.accountWithFreshAccessToken(issuedClientID: issuedClientID)
        try Task.checkCancellation()
        guard stored.hasDirectPlanAccess else { throw ChatGPTOAuthError.planPermissionMissing }
        guard let accessToken = stored.credentials?.accessToken else { throw ChatGPTOAuthError.reauthorizationRequired }
        return try await openResponseStream(request, accessToken: accessToken)
    }

    func generateResponse(
        _ request: ChatGPTResponsesRequest,
        for account: ChatGPTAccountAccess,
    ) async throws -> ChatGPTResponsesResult {
        let events = try await streamResponse(request, for: account)
        for try await event in events {
            if case let .completed(response) = event {
                return response
            }
        }
        throw ChatGPTResponsesError.interrupted
    }

    func generateResponse(
        _ request: ChatGPTResponsesRequest,
        forIssuedClientID issuedClientID: String,
    ) async throws -> ChatGPTResponsesResult {
        let events = try await streamResponse(request, forIssuedClientID: issuedClientID)
        for try await event in events {
            if case let .completed(response) = event {
                return response
            }
        }
        throw ChatGPTResponsesError.interrupted
    }

    private func openResponseStream(
        _ input: ChatGPTResponsesRequest,
        accessToken: String,
    ) async throws -> AsyncThrowingStream<ChatGPTResponsesEvent, Error> {
        let request = try ChatGPTResponsesRequestBuilder.build(input, accessToken: accessToken)
        try Task.checkCancellation()

        let response: URLResponse
        let body: AsyncThrowingStream<Data, Error>
        do {
            (response, body) = try await responsesTransport.stream(for: request)
        } catch {
            if Self.isCancellation(error) {
                throw CancellationError()
            }
            throw ChatGPTResponsesError.transportUnavailable
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw ChatGPTResponsesError.invalidHTTPResponse
        }
        let requestID = httpResponse.value(forHTTPHeaderField: "x-request-id")
        guard (200 ... 299).contains(httpResponse.statusCode) else {
            let diagnostics = try await ResponsesHTTPFailureParser.diagnostics(
                for: body,
                statusCode: httpResponse.statusCode,
                requestID: requestID,
            )
            throw ChatGPTResponsesError.httpFailure(diagnostics)
        }
        guard httpResponse.statusCode == 200 else { throw ChatGPTResponsesError.invalidHTTPResponse }
        let contentType = httpResponse.value(forHTTPHeaderField: "content-type")?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        // The direct plan route can omit MIME metadata. Only the expected API host may use
        // the same bounded SSE decoder without it; completion/call validation remains mandatory.
        let missingExpectedType = (contentType == nil || contentType == "") && httpResponse.url?.host?.lowercased() == "api.openai.com"
        guard contentType?.hasPrefix("text/event-stream") == true || missingExpectedType else {
            // Diagnose only closed header categories; never print URLs, tokens or response content.
            if ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS") {
                let mime = httpResponse.mimeType?.lowercased() ?? ""
                let category = ["application/json", "text/html", "text/plain", "application/octet-stream"].contains(mime)
                    ? mime : mime.isEmpty ? "missing" : "other"
                let host = httpResponse.url?.host?.lowercased() == "api.openai.com" ? "expected" : "other"
                NSLog("OROT_PROVIDER_DIAGNOSTIC provider=openai stage=headers status=%d content=%@ host=%@",
                      httpResponse.statusCode, category, host)
                if mime == "application/json" {
                    // The bounded parser returns structural categories only; provider code/message stays private.
                    let diagnostics = try await ResponsesHTTPFailureParser.diagnostics(
                        for: body, statusCode: httpResponse.statusCode, requestID: nil,
                    )
                    NSLog("OROT_PROVIDER_DIAGNOSTIC provider=openai stage=unexpected_json shape=%@ truncated=%d",
                          diagnostics.bodyShape ?? "unknown", diagnostics.bodyTruncated ? 1 : 0)
                }
            }
            throw ChatGPTResponsesError.invalidContentType
        }

        return AsyncThrowingStream { continuation in
            let task = Task {
                var decoder = ResponsesSSEDecoder()
                var normalizer = ResponsesEventNormalizer(requestID: requestID, publicWebSearch: input.publicWebQuery != nil)
                var publicStreamBytes = 0
                do {
                    for try await chunk in body {
                        try Task.checkCancellation()
                        if input.publicWebQuery != nil {
                            // Bound the entire hosted-search stream, including reasoning and
                            // repeated metadata, rather than only its displayed answer text.
                            publicStreamBytes += chunk.count
                            guard publicStreamBytes <= 1_048_576 else { throw ChatGPTResponsesError.malformedEvent }
                        }
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
