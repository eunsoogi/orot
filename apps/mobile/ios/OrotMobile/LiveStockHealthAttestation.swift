import CryptoKit
import Foundation

/// Compiled-in descriptor bytes derived from the ordinary Conversation contract.
enum LiveStockHealthAttestation {
    // BEGIN GENERATED CHAT HEALTH DESCRIPTOR
    // Generated from the stock Conversation contract; do not edit.
    private static let stockDigest = "6b40b886c70ce5e001d55038861f3eff1ce2b44624f6bdb561debb614e8a5d9f"
    private static let stockBytes =
        "eyJkZXNjcmlwdGlvbiI6IlJlYWQgbG9uZ2l0dWRpbmFsIGhlYWx0aCBjb250ZXh0IGFjcm9zcyBhbGwgYXZhaWxhYmxlIGlt" +
        "cG9ydGVkIGhpc3RvcnkgYnkgZGVmYXVsdC4gU3BlY2lmeSBwb3NpdGl2ZSBjYWxlbmRhciBkYXlzIG9yIGFuIGV4cGxpY2l0" +
        "IHdpbmRvdyBvbmx5IHdoZW4gdGhlIHJlcXVlc3RlZCBjbGluaWNhbCBwZXJpb2QgaXMgbmFycm93ZXIuIEZvciBicm9hZCBz" +
        "dW1tYXJpZXMgY2hvb3NlIHRvcGljcyBhbmQgc3VtbWFyeSwgd2Vla2x5LCBvciBkYWlseSBkZXRhaWwuIFN0ZXAgc2Vuc29y" +
        "IHN1bXMgYXJlIHNlcGFyYXRlLCBub3QgbWVyZ2VkIHRvdGFscy4gTWVhc3VyZW1lbnRzIGluY2x1ZGUgaGVhcnQtcmF0ZSBz" +
        "YW1wbGUgcmFuZ2VzIGdyb3VwZWQgYnkgdGltZSBvdmVybGFwIHdpdGggYWxyZWFkeSBpbXBvcnRlZCB3b3Jrb3V0IGludGVy" +
        "dmFscywgbm90IHByb29mIG9mIGV4ZXJjaXNlLCByZXN0IG9yIGNhdXNhdGlvbi4gTm8gbmV3IEhlYWx0aEtpdCByZWFkcyBh" +
        "cmUgcGVyZm9ybWVkLiBFeHBsaWNpdCB3aW5kb3dzIGFyZSBbZnJvbUluY2x1c2l2ZSwgdG9FeGNsdXNpdmUpIElTTyBpbnN0" +
        "YW50cyBpbiBhbiBJQU5BIHRpbWUgem9uZS4gQ29udmVydCBjYWxlbmRhciBib3VuZGFyaWVzIHVzaW5nIHRoZSByZXF1ZXN0" +
        "ZWQgem9uZS4gTWVkaWNhdGlvbiBkb3NlSGlzdG9yeSBzdXBwb3J0cyBhbiBleGFjdCBtZWRpY2F0aW9uTmFtZSBhbmQgbm9u" +
        "bmVnYXRpdmUgcGFnZSB3aXRoIHBhZ2VTaXplIDEtMjAuIEZvbGxvdyBoYXNNb3JlLiBSZWdpc3RyYXRpb24gYW5kIHNjaGVk" +
        "dWxlZCB0aW1lcyBhcmUgbm90IGludGFrZTsgYWJzZW50IGV2ZW50cyBhcmUgdW5rbm93bi4iLCJuYW1lIjoibG9jYWwtaGVh" +
        "bHRoLWNvbnRleHQiLCJwYXJhbWV0ZXJzIjp7ImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjpmYWxzZSwicHJvcGVydGllcyI6eyJk" +
        "YXlzIjp7ImRlc2NyaXB0aW9uIjoiUG9zaXRpdmUgbG9jYWwgY2FsZW5kYXIgZGF5cyBvbmx5IGZvciBhIHJlcXVlc3RlZCBy" +
        "ZWxhdGl2ZSBwZXJpb2Q7IG9taXQgZm9yIGFsbCBhdmFpbGFibGUgaGlzdG9yeS4iLCJ0eXBlIjoiaW50ZWdlciJ9LCJkZXRh" +
        "aWwiOnsiZW51bSI6WyJzdW1tYXJ5Iiwid2Vla2x5IiwiZGFpbHkiXSwidHlwZSI6InN0cmluZyJ9LCJ0b3BpY3MiOnsiaXRl" +
        "bXMiOnsiZW51bSI6WyJtZWRpY2F0aW9ucyIsIm1lYXN1cmVtZW50cyIsImFjdGl2aXR5Iiwic2xlZXAiLCJzeW1wdG9tcyJd" +
        "LCJ0eXBlIjoic3RyaW5nIn0sIm1heEl0ZW1zIjo1LCJtaW5JdGVtcyI6MSwidHlwZSI6ImFycmF5In0sIndpbmRvdyI6eyJh" +
        "ZGRpdGlvbmFsUHJvcGVydGllcyI6ZmFsc2UsImRlc2NyaXB0aW9uIjoiUGVyaW9kIGZvciBzZWxlY3RlZCB0b3BpY3M6IGV4" +
        "cGxpY2l0IElTTyBpbnN0YW50IGZyb21JbmNsdXNpdmUgYW5kIHRvRXhjbHVzaXZlLCBJQU5BIHRpbWVab25lLiBPbWl0IGRh" +
        "eXMuIE9wdGlvbmFsIGRvc2VIaXN0b3J5IHsgbWVkaWNhdGlvbk5hbWU/OiBleGFjdCBuYW1lLCBwYWdlOiB6ZXJvLWJhc2Vk" +
        "IGludGVnZXIsIHBhZ2VTaXplOiAxLTIwIH0gaXMgbWVkaWNhdGlvbnMtb25seS4iLCJwcm9wZXJ0aWVzIjp7ImRvc2VIaXN0" +
        "b3J5Ijp7ImFkZGl0aW9uYWxQcm9wZXJ0aWVzIjpmYWxzZSwicHJvcGVydGllcyI6eyJtZWRpY2F0aW9uTmFtZSI6eyJ0eXBl" +
        "Ijoic3RyaW5nIn0sInBhZ2UiOnsidHlwZSI6ImludGVnZXIifSwicGFnZVNpemUiOnsidHlwZSI6ImludGVnZXIifX0sInJl" +
        "cXVpcmVkIjpbInBhZ2UiLCJwYWdlU2l6ZSJdLCJ0eXBlIjoib2JqZWN0In0sImZyb21JbmNsdXNpdmUiOnsidHlwZSI6InN0" +
        "cmluZyJ9LCJ0aW1lWm9uZSI6eyJ0eXBlIjoic3RyaW5nIn0sInRvRXhjbHVzaXZlIjp7InR5cGUiOiJzdHJpbmcifX0sInJl" +
        "cXVpcmVkIjpbImZyb21JbmNsdXNpdmUiLCJ0b0V4Y2x1c2l2ZSIsInRpbWVab25lIl0sInR5cGUiOiJvYmplY3QifX0sInR5" +
        "cGUiOiJvYmplY3QifX0="
    // END GENERATED CHAT HEALTH DESCRIPTOR

    /// Only exact bytes derived from Conversation's stock schema can be advertised.
    static var stock: [String: Any] {
        guard let bytes = Data(base64Encoded: stockBytes), verifiesStockDigest(bytes),
              let descriptor = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(descriptor.keys) == ["description", "name", "parameters"],
              descriptor["name"] as? String == RealtimeVoiceCanonicalHealthAdmission.name,
              let description = descriptor["description"] as? String, !description.isEmpty,
              descriptor["parameters"] is [String: Any]
        else { return [:] }
        return descriptor
    }

    /// Compare the untrusted bridge's bounded descriptor, never a caller-provided digest.
    static func attestsStock(_ descriptor: [String: Any]) -> Bool {
        guard !stock.isEmpty,
              JSONSerialization.isValidJSONObject(descriptor),
              let bytes = try? JSONSerialization.data(withJSONObject: descriptor, options: [.sortedKeys, .withoutEscapingSlashes]),
              bytes == Data(base64Encoded: stockBytes)
        else { return false }
        return verifiesStockDigest(bytes)
    }

    private static func verifiesStockDigest(_ bytes: Data) -> Bool {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() == stockDigest
    }
}
