import Foundation
@testable import OpenAIProvider
import XCTest

final class FormBodyEncodingTests: XCTestCase {
    func testTokenExchangeFormBodyPreservesPlusAndSpaceInAuthorizationCode() throws {
        let request = try TokenExchangeRequestBuilder.build(
            endpoint: XCTUnwrap(URL(string: "https://auth.openai.com/oauth/token")),
            clientID: "registered-client",
            code: "synthetic+code value",
            codeVerifier: "verifier",
            redirectURI: XCTUnwrap(URL(string: "http://127.0.0.1:54321/auth/callback")),
        )

        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/x-www-form-urlencoded")
        XCTAssertEqual(
            request.httpBody.flatMap { String(data: $0, encoding: .utf8) },
            "client_id=registered-client&code=synthetic%2Bcode+value&code_verifier=verifier&grant_type=authorization_code&redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2Fauth%2Fcallback&resource=https%3A%2F%2Fapi.openai.com%2Fv1",
        )
    }
}
