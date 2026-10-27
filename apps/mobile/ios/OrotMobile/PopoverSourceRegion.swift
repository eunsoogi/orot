import ObjectiveC
import UIKit

/// Owns a framework UIView source item; UIKit's activity controller rejects arbitrary protocol conformers.
@available(iOS 17.0, *)
@MainActor
final class PopoverSourceRegion: NSObject {
    private static var retentionKey: UInt8 = 0
    let item = UIView()

    init(view: UIView, rect: CGRect) {
        super.init()
        item.frame = rect
        item.backgroundColor = .clear
        item.isUserInteractionEnabled = false
        item.isAccessibilityElement = false
        item.accessibilityElementsHidden = true
        view.addSubview(item)
    }

    /// The popover retains the region through presentation after the initiating anchor is released.
    func retain(on popover: UIPopoverPresentationController) {
        objc_setAssociatedObject(popover, &Self.retentionKey, self, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    deinit {
        // UIKit tears down presentations on the main actor; the source must not retain an orphan region.
        MainActor.assumeIsolated { item.removeFromSuperview() }
    }
}
