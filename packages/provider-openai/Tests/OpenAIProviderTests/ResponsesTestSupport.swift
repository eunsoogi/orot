import Foundation
@testable import OpenAIProvider

actor StubChatGPTResponsesHTTPTransport: ChatGPTResponsesHTTPTransport {
    private let statusCode: Int
    private let chunks: [Data]
    private let contentType: String?
    private let requestID: String?
    private let responseURL: URL?
    private var request: URLRequest?

    init(
        statusCode: Int = 200,
        chunks: [Data],
        contentType: String? = "text/event-stream",
        requestID: String? = "req_fixture",
        responseURL: URL? = nil,
    ) {
        self.statusCode = statusCode
        self.chunks = chunks
        self.contentType = contentType
        self.requestID = requestID
        self.responseURL = responseURL
    }

    func stream(for request: URLRequest) async throws -> (URLResponse, AsyncThrowingStream<Data, Error>) {
        self.request = request
        var headers = [String: String]()
        if let contentType {
            headers["Content-Type"] = contentType
        }
        if let requestID {
            headers["x-request-id"] = requestID
        }
        let response = HTTPURLResponse(
            url: responseURL ?? request.url!,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: headers,
        )!
        let stream = AsyncThrowingStream<Data, Error> { continuation in
            for chunk in chunks {
                continuation.yield(chunk)
            }
            continuation.finish()
        }
        return (response, stream)
    }

    func recordedRequest() -> URLRequest? {
        request
    }
}

func responsesClient(
    _ streamTransport: StubChatGPTResponsesHTTPTransport,
    store: InMemoryChatGPTCredentialStore? = nil,
    account: ChatGPTStoredAccount? = nil,
) throws -> ChatGPTOAuthClient {
    let credentials = store ?? InMemoryChatGPTCredentialStore()
    try credentials.saveAccount(account ?? syntheticAccount(expiresAt: Date().addingTimeInterval(3600)))
    return ChatGPTOAuthClient(
        transport: StubOAuthHTTPTransport { _ in StubOAuthResponse(statusCode: 404, body: Data()) },
        credentialStore: credentials,
        responsesTransport: streamTransport,
    )
}

func accountAccess(subject: String = "fixture-subject") -> ChatGPTAccountAccess {
    ChatGPTAccountAccess(
        issuedClientID: "oaiapp_fixture_client",
        subject: subject,
        grantedScopes: ["openid", ChatGPTOAuthConstants.directPlanScope],
        accessToken: "stale-context-token",
    )
}

func sseChunks(_ text: String, chunkSize: Int = 7) -> [Data] {
    let data = Data(text.utf8)
    return stride(from: 0, to: data.count, by: chunkSize).map { offset in
        Data(data[offset ..< min(offset + chunkSize, data.count)])
    }
}

func completedEvent(_ text: String) -> String {
    let escaped = text.replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
    return "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"\(escaped)\"}]}]}}\n\n"
}

func deltaEvent(_ text: String) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: ["type": "response.output_text.delta", "delta": text])
    return "event: response.output_text.delta\ndata: \(String(decoding: data, as: UTF8.self))\n\n"
}
