import Foundation

struct ResponsesSSEFrame: Equatable, Sendable {
    let event: String?
    let data: String
}

struct ResponsesSSEDecoder {
    private static let maximumLineBytes = 262_144
    private static let maximumFrameBytes = 1_048_576

    private var line = [UInt8]()
    private var dataLines = [String]()
    private var eventName: String?
    private var frameBytes = 0
    private var followsCarriageReturn = false

    mutating func append(_ chunk: Data) throws -> [ResponsesSSEFrame] {
        var frames = [ResponsesSSEFrame]()
        for byte in chunk {
            if followsCarriageReturn {
                followsCarriageReturn = false
                if byte == 0x0A {
                    continue
                }
            }

            if byte == 0x0D {
                if let frame = try finishLine() {
                    frames.append(frame)
                }
                followsCarriageReturn = true
            } else if byte == 0x0A {
                if let frame = try finishLine() {
                    frames.append(frame)
                }
            } else {
                guard line.count < Self.maximumLineBytes else { throw ResponsesSSEError.lineTooLarge }
                line.append(byte)
            }
        }
        return frames
    }

    mutating func finish() throws -> [ResponsesSSEFrame] {
        guard !line.isEmpty else { return [] }
        guard let text = String(bytes: line, encoding: .utf8) else { throw ResponsesSSEError.invalidUTF8 }
        line.removeAll(keepingCapacity: false)
        try consume(text)
        return []
    }

    private mutating func finishLine() throws -> ResponsesSSEFrame? {
        guard let text = String(bytes: line, encoding: .utf8) else { throw ResponsesSSEError.invalidUTF8 }
        frameBytes += line.count + 1
        guard frameBytes <= Self.maximumFrameBytes else { throw ResponsesSSEError.frameTooLarge }
        line.removeAll(keepingCapacity: true)

        guard !text.isEmpty else {
            defer {
                eventName = nil
                dataLines.removeAll(keepingCapacity: true)
                frameBytes = 0
            }
            guard !dataLines.isEmpty else { return nil }
            return ResponsesSSEFrame(event: eventName, data: dataLines.joined(separator: "\n"))
        }

        try consume(text)
        return nil
    }

    private mutating func consume(_ line: String) throws {
        guard !line.hasPrefix(":") else { return }
        let separator = line.firstIndex(of: ":")
        let field = separator.map { String(line[..<$0]) } ?? line
        var value = separator.map { String(line[line.index(after: $0)...]) } ?? ""
        if value.first == " " {
            value.removeFirst()
        }

        switch field {
        case "data":
            dataLines.append(value)
        case "event":
            eventName = value
        default:
            break
        }
    }
}

enum ResponsesSSEError: Error, Equatable {
    case invalidUTF8
    case lineTooLarge
    case frameTooLarge
}
