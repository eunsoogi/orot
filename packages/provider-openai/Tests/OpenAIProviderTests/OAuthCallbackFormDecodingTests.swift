import Foundation
import XCTest
@testable import OpenAIProvider

final class OAuthCallbackFormDecodingTests: XCTestCase {
    func testCallbackFormDecodesSpaceAndPreservesEncodedPlusThroughExchange() throws {
        let redirectURI = URL(string: "http://127.0.0.1:54321/auth/callback")!
        let callback = try OAuthCallbackParser.parse(
            URL(string: "http://127.0.0.1:54321/auth/callback?code=synthetic%2Bcode+value&state=expected&client_id=oaiapp_registered")!,
            expectedState: "expected",
            expectedRedirectURI: redirectURI
        )

        XCTAssertEqual(callback.code, "synthetic+code value")

        let request = TokenExchangeRequestBuilder.build(
            endpoint: URL(string: "https://auth.openai.com/oauth/token")!,
            clientID: callback.issuedClientID,
            code: callback.code,
            codeVerifier: "verifier",
            redirectURI: redirectURI
        )
        let body = request.httpBody.flatMap { String(data: $0, encoding: .utf8) }

        XCTAssertTrue(body?.contains("code=synthetic%2Bcode+value&") == true)
    }
}
