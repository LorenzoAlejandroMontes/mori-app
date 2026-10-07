// mori-sysaudio: the other side of the call, on macOS.
//
// Taps everything the Mac is playing (Core Audio process tap, macOS 14.2+) and
// writes it to stdout as 16 kHz mono signed 16-bit little-endian PCM, the exact
// shape scripts/record.py stores for the "others" channel. Logs go to stderr.
//
// A tap asks for the "System Audio Recording" permission only: no Screen
// Recording prompt. If the permission is denied the tap delivers silence, not
// an error, so the last stderr line always reports rms and peak.
//
//   mori-sysaudio --seconds 5 > out.pcm      capture five seconds, then exit
//   mori-sysaudio --until-stdin-closes       what record.py runs
//
// Call sequence follows Apple's "Capturing system audio with Core Audio taps".

import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

let outRate = 16000.0

var tapID = AudioObjectID(kAudioObjectUnknown)
var aggID = AudioObjectID(kAudioObjectUnknown)
var procID: AudioDeviceIOProcID?
var total = 0
var sumSq = 0.0
var peak = 0.0
var described = false

func log(_ s: String) {
    FileHandle.standardError.write(("mori-sysaudio: " + s + "\n").data(using: .utf8)!)
}

func die(_ s: String, _ code: Int32 = 1) -> Never {
    log(s)
    exit(code)
}

func check(_ status: OSStatus, _ what: String) {
    if status != noErr { die("\(what) failed (OSStatus \(status))") }
}

/// Stop, give the devices back, say how much was heard. Main queue only.
func finish(_ code: Int32) -> Never {
    if let p = procID {
        AudioDeviceStop(aggID, p)
        AudioDeviceDestroyIOProcID(aggID, p)
    }
    if aggID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggID) }
    if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID) }
    let rms = total > 0 ? (sumSq / Double(total)).squareRoot() : 0
    log(String(format: "frames=%d seconds=%.1f rms=%.4f peak=%.4f", total, Double(total) / outRate, rms, peak))
    exit(code)
}

func defaultOutputUID() -> String {
    var dev = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &dev),
          "reading the default output device")
    var uid: Unmanaged<CFString>?
    size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    addr.mSelector = kAudioDevicePropertyDeviceUID
    check(AudioObjectGetPropertyData(dev, &addr, 0, nil, &size, &uid), "reading the output device UID")
    guard let u = uid else { die("the default output device has no UID") }
    return u.takeRetainedValue() as String
}

// ---- arguments ---------------------------------------------------------------

var seconds: Double?
var followStdin = false
var args = CommandLine.arguments.dropFirst().makeIterator()
while let a = args.next() {
    switch a {
    case "--seconds":
        guard let v = args.next().flatMap(Double.init), v > 0 else { die("--seconds needs a number", 2) }
        seconds = v
    case "--until-stdin-closes":
        followStdin = true
    case "--help", "-h":
        print("usage: mori-sysaudio [--seconds N] [--until-stdin-closes]  (16 kHz mono s16le on stdout)")
        exit(0)
    default:
        die("unknown argument \(a)", 2)
    }
}

signal(SIGPIPE, SIG_IGN)

// ---- the tap: one mono mix of every process -----------------------------------

let outputUID = defaultOutputUID()

let tapDesc = CATapDescription(monoGlobalTapButExcludeProcesses: [])
tapDesc.uuid = UUID()
tapDesc.name = "Mori"
tapDesc.isPrivate = true
tapDesc.muteBehavior = .unmuted
check(AudioHardwareCreateProcessTap(tapDesc, &tapID), "creating the system audio tap")

var tapFormat = AudioStreamBasicDescription()
var fmtSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
var fmtAddr = AudioObjectPropertyAddress(
    mSelector: kAudioTapPropertyFormat,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
check(AudioObjectGetPropertyData(tapID, &fmtAddr, 0, nil, &fmtSize, &tapFormat), "reading the tap format")
if tapFormat.mFormatID != kAudioFormatLinearPCM || tapFormat.mFormatFlags & kAudioFormatFlagIsFloat == 0
    || tapFormat.mBitsPerChannel != 32 {
    die("unexpected tap format (id \(tapFormat.mFormatID), flags \(tapFormat.mFormatFlags), bits \(tapFormat.mBitsPerChannel))")
}
let inRate = tapFormat.mSampleRate

// ---- a private aggregate device that carries the tap ---------------------------

let aggDesc: [String: Any] = [
    kAudioAggregateDeviceNameKey: "Mori system audio",
    kAudioAggregateDeviceUIDKey: UUID().uuidString,
    kAudioAggregateDeviceMainSubDeviceKey: outputUID,
    kAudioAggregateDeviceIsPrivateKey: true,
    kAudioAggregateDeviceIsStackedKey: false,
    kAudioAggregateDeviceTapAutoStartKey: true,
    kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
    kAudioAggregateDeviceTapListKey: [[
        kAudioSubTapDriftCompensationKey: true,
        kAudioSubTapUIDKey: tapDesc.uuid.uuidString,
    ]],
]
check(AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggID), "creating the aggregate device")

// ---- tap rate, float -> 16 kHz, int16 ------------------------------------------

guard let inFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: inRate, channels: 1, interleaved: false),
      let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: outRate, channels: 1, interleaved: true),
      let converter = AVAudioConverter(from: inFormat, to: outFormat)
else { die("cannot convert \(inRate) Hz to \(outRate) Hz") }

let ioQueue = DispatchQueue(label: "mori.sysaudio.io")
check(AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, ioQueue) { _, inInputData, _, _, _ in
    let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
    if !described {
        described = true
        log("buffers=\(buffers.count) channels=\(buffers.map { Int($0.mNumberChannels) })")
    }
    // The tap's stream comes after the sub-device's own input streams, if any.
    guard let last = buffers.last, let raw = last.mData else { return }
    let ch = Int(max(last.mNumberChannels, 1))
    let frames = Int(last.mDataByteSize) / (MemoryLayout<Float32>.size * ch)
    guard frames > 0,
          let inBuf = AVAudioPCMBuffer(pcmFormat: inFormat, frameCapacity: AVAudioFrameCount(frames)),
          let dst = inBuf.floatChannelData?[0]
    else { return }
    let src = raw.assumingMemoryBound(to: Float32.self)
    if ch == 1 {
        dst.update(from: src, count: frames)
    } else {
        for i in 0..<frames {
            var s: Float32 = 0
            for c in 0..<ch { s += src[i * ch + c] }
            dst[i] = s / Float32(ch)
        }
    }
    inBuf.frameLength = AVAudioFrameCount(frames)

    let capacity = AVAudioFrameCount(Double(frames) * outRate / inRate) + 64
    guard let outBuf = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return }
    var fed = false
    var err: NSError?
    converter.convert(to: outBuf, error: &err) { _, status in
        if fed {
            status.pointee = .noDataNow
            return nil
        }
        fed = true
        status.pointee = .haveData
        return inBuf
    }
    let n = Int(outBuf.frameLength)
    guard n > 0, let pcm = outBuf.int16ChannelData?[0] else { return }
    for i in 0..<n {
        let v = abs(Double(pcm[i]) / 32768.0)
        sumSq += v * v
        if v > peak { peak = v }
    }
    total += n

    let bytes = n * 2
    pcm.withMemoryRebound(to: UInt8.self, capacity: bytes) { p in
        var off = 0
        while off < bytes {
            let w = write(1, p + off, bytes - off)
            if w <= 0 { exit(0) }  // nobody is reading any more
            off += w
        }
    }
}, "installing the audio callback")
check(AudioDeviceStart(aggID, procID), "starting the capture")
log("capturing output=\(outputUID) rate=\(Int(inRate)) -> \(Int(outRate)) mono s16le")

// ---- when to stop ---------------------------------------------------------------

var signalSources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let s = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    s.setEventHandler { finish(0) }
    s.resume()
    signalSources.append(s)
}
if let s = seconds {
    DispatchQueue.main.asyncAfter(deadline: .now() + s) { finish(0) }
}
if followStdin {
    Thread.detachNewThread {
        while !FileHandle.standardInput.availableData.isEmpty {}
        DispatchQueue.main.async { finish(0) }
    }
}
dispatchMain()
