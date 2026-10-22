/*
  Person matte: raw BGRA frames in on stdin, one 8-bit matte per frame out on stdout
  (255 = the person, 0 = background), the same size.

    matte <width> <height> [accurate|balanced|fast]

  Apple's Vision person segmentation, on the Mac's own Neural Engine. One request
  object sees every frame in order, so Vision can keep the matte steady from frame to
  frame. Vision's mask is smaller than the frame; it's scaled up guided by the frame
  itself (CIEdgePreserveUpsample), so the edge follows hair and shoulders instead of
  a blurry blob.

  ffmpeg decodes and encodes on both sides, so frame timing never lives here.
  Compiled on first use by lib/cutout.mjs (swiftc, from the Command Line Tools).
*/
import CoreImage
import CoreVideo
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 3, let W = Int(args[1]), let H = Int(args[2]), W > 0, H > 0 else {
  FileHandle.standardError.write("usage: matte <width> <height> [accurate|balanced|fast]\n".data(using: .utf8)!)
  exit(2)
}
let quality: VNGeneratePersonSegmentationRequest.QualityLevel =
  args.count > 3 && args[3] == "fast" ? .fast : args.count > 3 && args[3] == "balanced" ? .balanced : .accurate

let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = quality
request.outputPixelFormat = kCVPixelFormatType_OneComponent8
let sequence = VNSequenceRequestHandler()
let context = CIContext(options: [.workingColorSpace: NSNull(), .outputColorSpace: NSNull()])

var pb: CVPixelBuffer?
let attrs = [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary
guard CVPixelBufferCreate(nil, W, H, kCVPixelFormatType_32BGRA, attrs, &pb) == kCVReturnSuccess, let frame = pb else {
  FileHandle.standardError.write("matte: couldn't make a \(W)x\(H) buffer\n".data(using: .utf8)!)
  exit(1)
}

let frameBytes = W * H * 4
let input = FileHandle.standardInput
let output = FileHandle.standardOutput
var inBuf = [UInt8](repeating: 0, count: frameBytes)
var outBuf = [UInt8](repeating: 0, count: W * H)
let bounds = CGRect(x: 0, y: 0, width: W, height: H)

// Levels: Vision leaves faint ghosts (a cushion, a shadow) at low confidence. Below 25% is
// background, above 85% is the person, smoothstep between, so hair keeps a soft edge.
func level(_ v: Int) -> UInt8 {
  let x: Double = min(1.0, max(0.0, (Double(v) / 255.0 - 0.25) / 0.6))
  let y: Double = x * x * (3.0 - 2.0 * x)
  return UInt8((y * 255.0).rounded())
}
let levels: [UInt8] = (0..<256).map(level)

/** Fill inBuf with exactly one frame. False at the end of the stream. */
func readFrame() -> Bool {
  var have = 0
  while have < frameBytes {
    let n = inBuf.withUnsafeMutableBytes { read(0, $0.baseAddress! + have, frameBytes - have) }
    if n <= 0 { return false }
    have += n
  }
  return true
}

while readFrame() {
  CVPixelBufferLockBaseAddress(frame, [])
  let dst = CVPixelBufferGetBaseAddress(frame)!
  let stride = CVPixelBufferGetBytesPerRow(frame)
  inBuf.withUnsafeBytes { src in
    for y in 0..<H { memcpy(dst + y * stride, src.baseAddress! + y * W * 4, W * 4) }
  }
  CVPixelBufferUnlockBaseAddress(frame, [])

  var matte: CIImage? = nil
  do {
    try sequence.perform([request], on: frame, orientation: .up)
    if let mask = request.results?.first?.pixelBuffer {
      let small = CIImage(cvPixelBuffer: mask)
      let big = CIImage(cvPixelBuffer: frame)
      let up = CIFilter(name: "CIEdgePreserveUpsampleFilter", parameters: [
        kCIInputImageKey: big, "inputSmallImage": small, "inputSpatialSigma": 3.0, "inputLumaSigma": 0.15,
      ])?.outputImage
      // Fall back to a plain scale if the guided filter isn't there.
      matte = up ?? small.transformed(by: CGAffineTransform(scaleX: CGFloat(W) / small.extent.width, y: CGFloat(H) / small.extent.height))
    }
  } catch {
    FileHandle.standardError.write("matte: \(error.localizedDescription)\n".data(using: .utf8)!)
  }
  if let m = matte {
    outBuf.withUnsafeMutableBytes { context.render(m.cropped(to: bounds), toBitmap: $0.baseAddress!, rowBytes: W, bounds: bounds, format: .L8, colorSpace: nil) }
    for k in 0..<outBuf.count { outBuf[k] = levels[Int(outBuf[k])] }
  } else {
    for k in 0..<outBuf.count { outBuf[k] = 0 }
  }
  outBuf.withUnsafeBytes { output.write(Data($0)) }
}
