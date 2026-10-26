import Darwin.Mach
import Foundation

enum LocalE5ProcessMetrics {
    static func physicalFootprintBytes() -> UInt64? {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
            }
        }
        guard result == KERN_SUCCESS else { return nil }
        return UInt64(info.phys_footprint)
    }
}

/// Samples the app process while ONNX Runtime works so transient tensor memory is included in the probe result.
final class LocalE5MemorySampler {
    private let lock = NSLock()
    private let source = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "com.orot.local-e5-memory"))
    private var peak: UInt64 = 0

    init() {
        source.setEventHandler { [weak self] in self?.record() }
    }

    func start() {
        record()
        source.schedule(deadline: .now(), repeating: .milliseconds(40))
        source.resume()
    }

    func stop() -> UInt64? {
        source.cancel()
        record()
        lock.lock()
        defer { lock.unlock() }
        return peak == 0 ? nil : peak
    }

    private func record() {
        guard let footprint = LocalE5ProcessMetrics.physicalFootprintBytes() else { return }
        lock.lock()
        peak = max(peak, footprint)
        lock.unlock()
    }
}
