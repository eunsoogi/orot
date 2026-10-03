import Foundation
#if canImport(FoundationModels)
import FoundationModels

@available(iOS 26.0, *)
enum AppleFoundationModelsCodec {
  static func schema(_ value: [String: Any]) throws -> DynamicGenerationSchema {
    let name = value["name"] as? String ?? "AppleSchema"
    let description = value["description"] as? String
    switch value["kind"] as? String {
    case "string": return DynamicGenerationSchema(type: String.self)
    case "integer": return DynamicGenerationSchema(type: Int.self)
    case "number": return DynamicGenerationSchema(type: Double.self)
    case "boolean": return DynamicGenerationSchema(type: Bool.self)
    case "enum":
      guard let values = value["values"] as? [String], !values.isEmpty else { throw schemaError() }
      return DynamicGenerationSchema(name: name, description: description, anyOf: values)
    case "array":
      guard let item = value["item"] as? [String: Any] else { throw schemaError() }
      return DynamicGenerationSchema(arrayOf: try schema(item),
        minimumElements: value["minimumElements"] as? Int, maximumElements: value["maximumElements"] as? Int)
    case "object":
      guard let raw = value["properties"] as? [[String: Any]] else { throw schemaError() }
      let properties = try raw.map { property -> DynamicGenerationSchema.Property in
        guard let key = property["name"] as? String,
          let child = property["schema"] as? [String: Any] else { throw schemaError() }
        return DynamicGenerationSchema.Property(name: key,
          description: property["description"] as? String, schema: try schema(child),
          isOptional: property["optional"] as? Bool ?? false)
      }
      return DynamicGenerationSchema(name: name, description: description, properties: properties)
    case "union":
      guard let choices = value["choices"] as? [[String: Any]], !choices.isEmpty else { throw schemaError() }
      return DynamicGenerationSchema(name: name, description: description,
        anyOf: try choices.map { try schema($0) })
    default: throw schemaError()
    }
  }

  static func normalize(_ json: String, _ request: [String: Any], requestId: String) throws -> [String: Any] {
    guard let data = json.data(using: .utf8) else { throw failure("Invalid generated text.") }
    let value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    let mode = request["mode"] as? String ?? "text"
    if mode == "structured" {
      return ["text": jsonText(value), "structuredOutput": value, "toolCalls": [], "finishReason": "complete"]
    }
    guard let output = value as? [String: Any], let kind = output["kind"] as? String else {
      throw failure("Model returned an invalid guided response.")
    }
    if kind == "structured" {
      let result = output["value"] ?? NSNull()
      return ["text": jsonText(result), "structuredOutput": result, "toolCalls": [], "finishReason": "complete"]
    }
    if kind == "text" {
      return ["text": output["text"] as? String ?? "", "toolCalls": [], "finishReason": "complete"]
    }
    guard kind == "tool_calls", let values = output["toolCalls"] as? [[String: Any]] else {
      throw failure("Model returned an invalid tool response.")
    }
    let allowed = Set(request["toolNames"] as? [String] ?? [])
    let calls = try values.enumerated().map { index, call -> [String: Any] in
      guard let name = call["name"] as? String, allowed.contains(name),
        let arguments = call["arguments"] as? [String: Any] else {
        throw failure("Model returned an invalid tool call.")
      }
      return ["id": requestId + "-tool-" + String(index), "name": name, "arguments": arguments]
    }
    return ["text": "", "toolCalls": calls, "finishReason": "tool_calls"]
  }

  private static func jsonText(_ value: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys]) else {
      return String(describing: value)
    }
    return String(data: data, encoding: .utf8) ?? ""
  }

  private static func schemaError() -> NSError {
    NSError(domain: "AppleFoundationModels", code: 1, userInfo: [
      NSLocalizedDescriptionKey: "Apple Foundation Models could not represent this schema.",
      "code": "UNSUPPORTED_CAPABILITY",
    ])
  }

  private static func failure(_ message: String) -> NSError {
    NSError(domain: "AppleFoundationModels", code: 1, userInfo: [
      NSLocalizedDescriptionKey: message, "code": "GENERATION_FAILED",
    ])
  }
}
#endif
