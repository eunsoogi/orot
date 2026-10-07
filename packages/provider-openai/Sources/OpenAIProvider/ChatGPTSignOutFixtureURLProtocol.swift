#if DEBUG
    import Foundation

    /// Keeps native Simulator sign-out proof offline and scoped to the synthetic fixture client.
    final class ChatGPTSignOutFixtureURLProtocol: URLProtocol {
        private static let discoveryPath = "/.well-known/openid-configuration"
        private static let revocationPath = "/api/accounts/oauth/revoke"

        override class func canInit(with request: URLRequest) -> Bool {
            guard ChatGPTPlanFixtureState.shared.isActive,
                  let url = request.url,
                  url.host == "auth.openai.com"
            else { return false }
            // Keep unexpected auth requests inside the offline fixture and fail them closed.
            return true
        }

        override class func canonicalRequest(for request: URLRequest) -> URLRequest {
            request
        }

        override func startLoading() {
            guard let url = request.url else { return respond(status: 400) }
            if request.httpMethod == "GET", url.path == Self.discoveryPath {
                let body = #"{"issuer":"https://auth.openai.com","authorization_endpoint":"https://auth.openai.com/oauth/authorize","token_endpoint":"https://auth.openai.com/oauth/token","jwks_uri":"https://auth.openai.com/oauth/jwks","revocation_endpoint":"https://auth.openai.com/api/accounts/oauth/revoke"}"#
                return respond(status: 200, body: Data(body.utf8))
            }
            guard request.httpMethod == "POST", url.path == Self.revocationPath else {
                return respond(status: 404)
            }
            respond(status: 200)
        }

        override func stopLoading() {}

        private func respond(status: Int, body: Data = Data()) {
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"],
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        }
    }
#endif
