import UIKit

/// Provides native image inspection helpers so glyph bounds can be compared independently of touch-target size.
@MainActor
enum AppSymbolSizingTestAssertions {
    static func firstImageView(in view: UIView) -> UIImageView? {
        if let imageView = view as? UIImageView, imageView.image != nil {
            return imageView
        }
        for subview in view.subviews {
            if let imageView = firstImageView(in: subview) {
                return imageView
            }
        }
        return nil
    }

    /// Measures visible alpha pixels inside UIKit's symbol image view rather than assuming its full frame is ink.
    static func visibleGlyphBounds(in imageView: UIImageView) -> CGRect? {
        let scale: CGFloat = 3
        let width = Int((imageView.bounds.width * scale).rounded(.up))
        let height = Int((imageView.bounds.height * scale).rounded(.up))
        guard width > 0, height > 0 else { return nil }
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        return pixels.withUnsafeMutableBytes { buffer -> CGRect? in
            let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue).union(.byteOrder32Big)
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                          bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: bitmapInfo.rawValue) else { return nil }
            context.scaleBy(x: scale, y: scale)
            imageView.layer.render(in: context)
            let values = buffer.bindMemory(to: UInt8.self)
            var minX = width, minY = height, maxX = -1, maxY = -1
            for pixel in 0 ..< (width * height) where values[pixel * 4 + 3] > 8 {
                let x = pixel % width, y = pixel / width
                minX = min(minX, x); minY = min(minY, y)
                maxX = max(maxX, x); maxY = max(maxY, y)
            }
            guard maxX >= minX, maxY >= minY else { return nil }
            return CGRect(x: CGFloat(minX) / scale, y: CGFloat(minY) / scale,
                          width: CGFloat(maxX - minX + 1) / scale, height: CGFloat(maxY - minY + 1) / scale)
        }
    }
}
