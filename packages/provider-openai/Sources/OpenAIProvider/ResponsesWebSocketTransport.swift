import Foundation

protocol ResponsesWebSocketConnection: Sendable {
    func send(_ data: Data) async throws
    func receive() async throws -> Data
    func close()
}

/// Only the documented Responses endpoint is admitted. No private ChatGPT routes or reconnect replay.
struct URLSessionResponsesWebSocket: ResponsesWebSocketConnection {
    let task: URLSessionWebSocketTask

    init(accessToken: String) throws {
        guard !accessToken.isEmpty else { throw ChatGPTOAuthError.reauthorizationRequired }
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/responses")!)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 180
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        task = URLSession(configuration: configuration).webSocketTask(with: request)
        task.maximumMessageSize = 1_048_576
        task.resume()
    }

    func send(_ data: Data) async throws {
        guard let text = String(data: data, encoding: .utf8) else { throw ChatGPTResponsesError.invalidRequest }
        try await task.send(.string(text))
    }

    func receive() async throws -> Data {
        switch try await task.receive() {
        case let .string(text): return Data(text.utf8)
        case let .data(data): return data
        @unknown default: throw ChatGPTResponsesError.malformedEvent
        }
    }

    func close() { task.cancel(with: .goingAway, reason: nil) }
}

public extension ChatGPTOAuthClient {
    /// Refresh and scope checks match SSE. A rejected upgrade is surfaced, never silently retried as another request.
    func steerableResponse(_ request: ChatGPTResponsesRequest, forIssuedClientID issuedClientID: String) async throws -> ChatGPTSteerableResponse {
        guard ChatGPTSteerableResponse.supportsModel(request.model), request.publicWebQuery == nil else {
            throw ChatGPTResponsesError.unsupportedCapability("mid-turn steering")
        }
        let stored = try await sessionManager.accountWithFreshAccessToken(issuedClientID: issuedClientID)
        try Task.checkCancellation()
        guard stored.hasDirectPlanAccess else { throw ChatGPTOAuthError.planPermissionMissing }
        guard let token = stored.credentials?.accessToken else { throw ChatGPTOAuthError.reauthorizationRequired }
        let body = try ChatGPTResponsesRequestBuilder.build(request, accessToken: token).httpBody!
        var payload = try JSONSerialization.jsonObject(with: body) as! [String: Any]
        payload.removeValue(forKey: "stream")
        payload["type"] = "response.create"
        let encoded = try JSONSerialization.data(withJSONObject: payload)
        return ChatGPTSteerableResponse(connection: try URLSessionResponsesWebSocket(accessToken: token), initialRequest: encoded)
    }
}
