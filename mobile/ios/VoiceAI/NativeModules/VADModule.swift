/**
 * VADModule — iOS native module for on-device Voice Activity Detection.
 *
 * Implements an energy-based VAD using RMS amplitude of the incoming Float32 PCM
 * audio. Uses hysteresis (separate speech-start and speech-end counters) to avoid
 * rapid state flapping on breath sounds or brief silences.
 *
 * This avoids requiring an external ONNX runtime / Silero model on-device while
 * still providing reliable voice/silence discrimination for mic-recorded speech.
 *
 * Typical energy levels (normalized Float32 PCM, mic at arm's length):
 *   Background noise:  RMS ~0.003 – 0.010
 *   Soft speech:       RMS ~0.015 – 0.040
 *   Normal speech:     RMS ~0.040 – 0.150
 *
 * The threshold is derived from the caller's `threshold` param (0–1 scale where
 * higher = less sensitive) via: energyThreshold = 0.005 + threshold * 0.045
 *   threshold 0.0 → 0.005  (catches near-whispers)
 *   threshold 0.5 → 0.028  (default, normal speech)
 *   threshold 1.0 → 0.050  (only loud speech)
 */

import Foundation
import React

@objc(VADModule)
class VADModule: RCTEventEmitter {

  private var isInitialized = false
  private var currentIsSpeaking = false

  // Derived from config
  private var energyThreshold: Float = 0.028
  private var minSpeechFrames: Int = 8    // consecutive voiced frames before declaring speech
  private var minSilenceFrames: Int = 10  // consecutive silent frames before ending speech

  // Hysteresis counters
  private var voicedFrameCount: Int = 0
  private var silentFrameCount: Int = 0

  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String] {
    return ["onVADStateChange"]
  }

  @objc func initVAD(
    _ config: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let threshold = config["threshold"] as? Float ?? 0.5
    let frameSizeMs = config["frameSizeMs"] as? Int ?? 30
    let minSpeechMs = config["minSpeechDurationMs"] as? Int ?? 250
    let minSilenceMs = config["minSilenceDurationMs"] as? Int ?? 300

    energyThreshold = 0.005 + threshold * 0.045
    minSpeechFrames = max(1, minSpeechMs / frameSizeMs)
    minSilenceFrames = max(1, minSilenceMs / frameSizeMs)

    voicedFrameCount = 0
    silentFrameCount = 0
    currentIsSpeaking = false
    isInitialized = true
    resolve(nil)
  }

  @objc func process(
    _ base64Samples: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard isInitialized else {
      resolve(false)
      return
    }

    guard let data = Data(base64Encoded: base64Samples),
          data.count >= MemoryLayout<Float>.size else {
      resolve(currentIsSpeaking)
      return
    }

    // Calculate RMS energy of the audio chunk
    let sampleCount = data.count / MemoryLayout<Float>.size
    var sumSquares: Float = 0
    data.withUnsafeBytes { rawBytes in
      if let floatPtr = rawBytes.baseAddress?.assumingMemoryBound(to: Float.self) {
        for i in 0..<sampleCount {
          let s = floatPtr[i]
          sumSquares += s * s
        }
      }
    }
    let rms = (sumSquares / Float(sampleCount)).squareRoot()
    let isVoiced = rms >= energyThreshold

    let previouslySpeaking = currentIsSpeaking

    if isVoiced {
      voicedFrameCount += 1
      silentFrameCount = 0
      if !currentIsSpeaking && voicedFrameCount >= minSpeechFrames {
        currentIsSpeaking = true
      }
    } else {
      silentFrameCount += 1
      voicedFrameCount = 0
      if currentIsSpeaking && silentFrameCount >= minSilenceFrames {
        currentIsSpeaking = false
      }
    }

    if currentIsSpeaking != previouslySpeaking {
      let timestamp = Int(Date().timeIntervalSince1970 * 1000)
      let probability: Float = isVoiced ? min(rms / energyThreshold, 1.0) : 0.0
      sendEvent(withName: "onVADStateChange", body: [
        "isSpeaking": currentIsSpeaking,
        "probability": probability,
        "timestamp": timestamp,
      ])
    }

    resolve(currentIsSpeaking)
  }

  @objc func reset(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    currentIsSpeaking = false
    voicedFrameCount = 0
    silentFrameCount = 0
    resolve(nil)
  }

  @objc func release(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    isInitialized = false
    currentIsSpeaking = false
    voicedFrameCount = 0
    silentFrameCount = 0
    resolve(nil)
  }
}
