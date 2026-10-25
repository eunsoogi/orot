#if DEBUG
    import Foundation

    enum ChatGPTPlanFixtureEvents {
        private static func event(_ name: String, _ payload: [String: Any]) -> Data {
            let json = try! JSONSerialization.data(withJSONObject: payload)
            var data = Data("event: \(name)\r\ndata: ".utf8)
            data.append(json)
            data.append(Data("\r\n\r\n".utf8))
            return data
        }

        static func delta(_ text: String) -> Data {
            event("response.output_text.delta", ["type": "response.output_text.delta", "delta": text])
        }

        static func completed(_ text: String) -> Data {
            event("response.completed", [
                "type": "response.completed",
                "response": ["status": "completed", "output_text": text],
            ])
        }

        static let functionCallAdded = event("response.output_item.added", [
            "type": "response.output_item.added",
            "item": [
                "type": "function_call",
                "id": "fc_synthetic_source",
                "call_id": "call_synthetic_source",
                "name": "lookup_source",
                "arguments": "",
            ],
        ])

        static let functionCallArgumentsDelta = event("response.function_call_arguments.delta", [
            "type": "response.function_call_arguments.delta",
            "item_id": "fc_synthetic_source",
            "delta": #"{"sourceId":"source-42"}"#,
        ])

        static let functionCallArgumentsDone = event("response.function_call_arguments.done", [
            "type": "response.function_call_arguments.done",
            "item_id": "fc_synthetic_source",
            "arguments": #"{"sourceId":"source-42"}"#,
        ])

        static let completedToolCall = event("response.completed", [
            "type": "response.completed",
            "response": [
                "status": "completed",
                "output_text": "",
                "output": [
                    ["type": "reasoning", "id": "rs_synthetic_source", "encrypted_content": "synthetic-only"],
                    [
                        "type": "function_call",
                        "id": "fc_synthetic_source",
                        "call_id": "call_synthetic_source",
                        "name": "lookup_source",
                        "arguments": #"{"sourceId":"source-42"}"#,
                    ],
                ],
            ],
        ])

        static func completedToolRoundTrip(_ text: String) -> Data {
            event("response.completed", [
                "type": "response.completed",
                "response": [
                    "status": "completed",
                    "output_text": text,
                    "output": [[
                        "type": "message",
                        "content": [["type": "output_text", "text": text]],
                    ]],
                ],
            ])
        }

        static let failure = event("error", [
            "type": "error",
            "code": "subscription_sharing_usage_limit_exceeded",
            "message": "The ChatGPT plan usage limit was reached.",
            "param": "model",
        ])
    }
#endif
