import CoreGraphics

/// Readiness describes keyboard and workspace convergence, never Send clearance.
enum RoutesKeyboardReadiness {
    static func ready(keyboardEvent: CGRect, keyboardAX: CGRect, baseline: CGRect, shared: CGRect, host: CGRect, workspace: CGRect) -> Bool {
        let rects = [keyboardEvent, keyboardAX, baseline, shared, host, workspace]
        guard rects.allSatisfy({ !$0.isNull && !$0.isEmpty && [$0.minX, $0.minY, $0.width, $0.height].allSatisfy(\.isFinite) }) else { return false }
        let tolerance: CGFloat = 1
        // The measured host may lag the shell; production clips the inner workspace to their intersection.
        let visibleHost = host.intersection(shared)
        return keyboardEvent.insetBy(dx: -tolerance, dy: -tolerance).contains(keyboardAX)
            && shared.maxY < baseline.maxY - tolerance
            && shared.maxY <= keyboardEvent.minY + tolerance
            && !visibleHost.isNull && !visibleHost.isEmpty
            && abs(workspace.minY - visibleHost.minY) <= tolerance
            && abs(workspace.maxY - visibleHost.maxY) <= tolerance
    }
}
