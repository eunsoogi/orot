import Foundation

enum TokenExchangeRequestBuilder {
    static func build(
        endpoint: URL,
        clientID: String,
        code: String,
        codeVerifier: String,
        redirectURI: URL
    ) -> URLRequest {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = formBody([
            "grant_type": "authorization_code",
            "client_id": clientID,
            "code": code,
            "code_verifier": codeVerifier,
            "redirect_uri": redirectURI.absoluteString,
            "resource": ChatGPTOAuthConstants.resource,
        ])
        return request
    }

    private static func formBody(_ values: [String: String]) -> Data {
        let fields = values.sorted { $0.key < $1.key }.map { field in
            "\(formComponent(field.key))=\(formComponent(field.value))"
        }
        return Data(fields.joined(separator: "&").utf8)
    }

    private static func formComponent(_ value: String) -> String {
        let hexDigits = Array("0123456789ABCDEF".utf8)
        var encoded = [UInt8]()
        encoded.reserveCapacity(value.utf8.count)
        for byte in value.utf8 {
            switch byte {
            case 0x2A, 0x2D, 0x2E, 0x5F, 0x30...0x39, 0x41...0x5A, 0x61...0x7A:
                encoded.append(byte)
            case 0x20:
                encoded.append(0x2B)
            default:
                encoded.append(0x25)
                encoded.append(hexDigits[Int(byte >> 4)])
                encoded.append(hexDigits[Int(byte & 0x0F)])
            }
        }
        return String(decoding: encoded, as: UTF8.self)
    }
}
