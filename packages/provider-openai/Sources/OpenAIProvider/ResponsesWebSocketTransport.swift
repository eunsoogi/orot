import Foundation

protocol ResponsesWebSocketConnection: Sendable {
    func send(_ data: Data) async throws
    func receive() async throws -> Data
    func close()
    func completed()
}

extension ResponsesWebSocketConnection {
    func completed() {
        close()
    }
}

/// Only the documented Responses endpoint is admitted. No private ChatGPT routes or reconnect replay.
struct URLSessionResponsesWebSocket: ResponsesWebSocketConnection {
    let task: URLSessionWebSocketTask
    private let session: URLSession
    private let upgrade: ResponsesWebSocketUpgradeDelegate

    init(accessToken: String) throws {
        guard !accessToken.isEmpty else { throw ChatGPTOAuthError.reauthorizationRequired }
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/responses")!)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 180
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.httpShouldSetCookies = false
        upgrade = ResponsesWebSocketUpgradeDelegate()
        session = URLSession(configuration: configuration, delegate: upgrade, delegateQueue: nil)
        task = session.webSocketTask(with: request)
        task.maximumMessageSize = 1_048_576
        task.resume()
    }

    func waitUntilOpen() async throws {
        try await withTaskCancellationHandler {
            try Task.checkCancellation()
            try await upgrade.gate.wait()
            try Task.checkCancellation()
        } onCancel: { close() }
    }

    func send(_ data: Data) async throws {
        guard let text = String(data: data, encoding: .utf8) else { throw ChatGPTResponsesError.invalidRequest }
        try await task.send(.string(text))
    }

    func receive() async throws -> Data {
        switch try await task.receive() {
        case let .string(text): return Data(text.utf8)
        case let .data(data): return data
        @unknown default: throw ResponsesMalformedDiagnostics.failure(.webSocketMessageKind)
        }
    }

    func close() {
        upgrade.gate.cancelled()
        task.cancel(with: .goingAway, reason: nil)
        session.invalidateAndCancel()
    }
}

public extension ChatGPTOAuthClient {
    /// Refresh and scope checks match SSE. No response.create can be sent until the upgrade is confirmed.
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
        let key = request.transportScope.map {
            ResponsesConnectionPool.Key(scope: $0, account: issuedClientID, model: request.model, credential: token)
        }
        let pooled = key.map { responseConnections.take($0) }
        let connection: any ResponsesWebSocketConnection
        if let reused = pooled?.1 {
            connection = reused
        } else {
            let fresh = try URLSessionResponsesWebSocket(accessToken: token)
            do { try await fresh.waitUntilOpen() } catch { fresh.close(); throw error }
            connection = fresh
        }
        let owned = pooled.map { responseConnections.lease(connection, generation: $0.0) } ?? connection
        do {
            try Task.checkCancellation()
            return ChatGPTSteerableResponse(connection: owned, initialRequest: encoded)
        } catch {
            owned.close()
            throw error
        }
    }
}
