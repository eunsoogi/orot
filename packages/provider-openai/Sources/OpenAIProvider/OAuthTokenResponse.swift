import Foundation

struct OAuthTokenEndpointError: Decodable {
    let code: String?

    enum CodingKeys: String, CodingKey {
        case code = "error"
    }
}

struct OAuthTokenResponse: Decodable {
    let accessToken: String?
    let refreshToken: String?
    let idToken: String?
    let tokenType: String?
    let expiresIn: TimeInterval?
    let scope: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case idToken = "id_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case scope
    }
}
