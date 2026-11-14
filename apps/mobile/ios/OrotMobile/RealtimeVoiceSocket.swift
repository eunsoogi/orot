import Foundation

/// Ordered, bounded WebSocket writes; never logs authentication, remote errors or audio.
protocol RealtimeSocketPort: AnyObject {
    var received: (([String: Any]) -> Void)? { get set }
    var failed: (() -> Void)? { get set }
    func open(model: String, key: String)
    func send(_ event: [String: Any])
    func discardInput()
    func close()
}

final class RealtimeVoiceSocket: RealtimeSocketPort {
    private let session = URLSession(configuration: .ephemeral)
    private var socket: URLSessionWebSocketTask?
    private var queue: [RealtimeSocketWrite] = []
    private var bytes = 0
    private var sending = false
    private var epoch = 0
    var received: (([String: Any]) -> Void)?
    var failed: (() -> Void)?

    func open(model: String, key: String) {
        var request = URLRequest(url: URL(string: "wss://api.openai.com/v1/realtime?model=\(model)")!)
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = 1024 * 1024
        socket = task
        task.resume()
        receive(task, epoch: epoch)
    }

    func send(_ event: [String: Any]) {
        guard socket != nil, let data = try? JSONSerialization.data(withJSONObject: event),
              let string = String(data: data, encoding: .utf8) else { failed?(); return }
        guard bytes + data.count <= 512 * 1024 else { failed?(); return }
        bytes += data.count
        queue.append(RealtimeSocketWrite(text: string, isInput: event["type"] as? String == "input_audio_buffer.append"))
        flush()
    }

    private func flush() {
        guard !sending, let task = socket, let message = queue.first else { return }
        sending = true
        let current = epoch
        task.send(.string(message.text)) { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.epoch == current else { return }
                self.sending = false
                if error != nil {
                    self.failed?(); return
                }
                self.bytes -= self.queue.removeFirst().text.utf8.count
                self.flush()
            }
        }
    }

    private func receive(_ task: URLSessionWebSocketTask, epoch current: Int) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                guard self.epoch == current, self.socket === task else { return }
                guard case let .success(message) = result else { self.failed?(); return }
                let data: Data
                switch message {
                case let .data(value): data = value
                case let .string(value): data = Data(value.utf8)
                @unknown default: self.failed?(); return
                }
                guard let event = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { self.failed?(); return }
                self.received?(event)
                if self.socket === task {
                    self.receive(task, epoch: current)
                }
            }
        }
    }

    /// Mute drops unsent audio while preserving ordered control messages. A write already handed
    /// to URLSession cannot be retracted; input_audio_buffer.clear follows it on the same socket.
    func discardInput() {
        queue = Self.retainingControl(queue, sending: sending)
        bytes = queue.reduce(0) { $0 + $1.text.utf8.count }
    }

    static func retainingControl(_ writes: [RealtimeSocketWrite], sending: Bool) -> [RealtimeSocketWrite] {
        writes.enumerated().compactMap { index, write in
            (sending && index == 0) || !write.isInput ? write : nil
        }
    }

    func close() {
        epoch += 1
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        queue.removeAll(); bytes = 0; sending = false
    }

    deinit { socket?.cancel(with: .goingAway, reason: nil); session.invalidateAndCancel() }
}

/// The queue records event kind before serialization; filtering never inspects audio contents.
struct RealtimeSocketWrite {
    let text: String
    let isInput: Bool
}
