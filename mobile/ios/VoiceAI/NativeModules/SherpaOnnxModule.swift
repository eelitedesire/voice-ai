/**
 * SherpaOnnxModule — iOS native module for on-device ASR and speaker embedding.
 *
 * Uses Apple's Speech framework (SFSpeechRecognizer) for on-device transcription.
 * No external model files are required — the system's on-device recognition model
 * is used automatically (iOS 13+, Neural Engine accelerated on A/M-series chips).
 *
 * Speaker embedding extraction is not available via this framework; the methods
 * are kept API-compatible but return zero-vectors so the rest of the pipeline
 * (cosine-similarity speaker matching) can still operate if voiceprints are
 * pre-enrolled via the server.
 */

import Foundation
import React
import Speech
import AVFoundation

@objc(SherpaOnnxModule)
class SherpaOnnxModule: RCTEventEmitter {

  private var speechRecognizer: SFSpeechRecognizer?
  private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
  private var recognitionTask: SFSpeechRecognitionTask?
  private var audioFormat: AVAudioFormat?
  private var isASRInitialized = false
  private var isSpeakerInitialized = false

  // Serial queue so feedAudio / resetASR calls never race
  private let asrQueue = DispatchQueue(label: "com.voiceai.asr", qos: .userInteractive)

  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  override func supportedEvents() -> [String] {
    return ["onPartialResult", "onFinalResult"]
  }

  // MARK: - ASR

  @objc func initASR(
    _ config: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let sampleRate = config["sampleRate"] as? Double ?? 16000.0

    SFSpeechRecognizer.requestAuthorization { [weak self] status in
      guard let self = self else { return }
      switch status {
      case .authorized:
        // Prefer the system locale; fall back to en-US so we always have a recognizer
        let locale = Locale.current.languageCode != nil
          ? Locale.current
          : Locale(identifier: "en-US")
        self.speechRecognizer = SFSpeechRecognizer(locale: locale)
        self.speechRecognizer?.defaultTaskHint = .dictation

        self.audioFormat = AVAudioFormat(
          commonFormat: .pcmFormatFloat32,
          sampleRate: sampleRate,
          channels: 1,
          interleaved: false
        )
        self.isASRInitialized = true
        resolve(nil)

      case .denied:
        reject("PERMISSION_DENIED", "Speech recognition permission was denied", nil)
      case .restricted:
        reject("PERMISSION_RESTRICTED", "Speech recognition is restricted on this device", nil)
      case .notDetermined:
        reject("PERMISSION_NOT_DETERMINED", "Speech recognition permission not yet determined", nil)
      @unknown default:
        reject("PERMISSION_ERROR", "Unknown speech recognition permission status", nil)
      }
    }
  }

  // Starts a fresh SFSpeechAudioBufferRecognitionRequest and recognition task.
  // Must be called from asrQueue.
  private func startRecognitionTaskLocked() {
    guard let recognizer = speechRecognizer, recognizer.isAvailable,
          let format = audioFormat else { return }

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    if #available(iOS 13, *) {
      request.requiresOnDeviceRecognition = true
    }

    recognitionRequest = request

    recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self = self else { return }

      if let result = result {
        let text = result.bestTranscription.formattedString
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        if result.isFinal {
          self.sendEvent(withName: "onFinalResult", body: [
            "text": text,
            "timestamp": timestamp,
            "isEndpoint": true,
          ])
        } else if !text.isEmpty {
          self.sendEvent(withName: "onPartialResult", body: [
            "text": text,
            "timestamp": timestamp,
          ])
        }
      }

      if error != nil || (result?.isFinal ?? false) {
        self.asrQueue.async { [weak self] in
          self?.recognitionTask = nil
          self?.recognitionRequest = nil
        }
      }
    }

    _ = format // silence unused-variable warning; format stored on self
  }

  @objc func feedAudio(
    _ base64Samples: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard isASRInitialized else {
      reject("NOT_INITIALIZED", "ASR not initialized", nil)
      return
    }

    guard let data = Data(base64Encoded: base64Samples) else {
      reject("DECODE_ERROR", "Failed to decode base64 audio", nil)
      return
    }

    asrQueue.async { [weak self] in
      guard let self = self, let format = self.audioFormat else { return }

      // Start a new recognition task if one is not already running
      if self.recognitionTask == nil {
        self.startRecognitionTaskLocked()
      }

      let sampleCount = data.count / MemoryLayout<Float>.size
      guard sampleCount > 0,
            let buffer = AVAudioPCMBuffer(
              pcmFormat: format,
              frameCapacity: AVAudioFrameCount(sampleCount)
            ) else {
        resolve(nil)
        return
      }

      buffer.frameLength = AVAudioFrameCount(sampleCount)
      if let channelData = buffer.floatChannelData?[0] {
        data.withUnsafeBytes { rawBytes in
          if let floatPtr = rawBytes.baseAddress?.assumingMemoryBound(to: Float.self) {
            channelData.update(from: floatPtr, count: sampleCount)
          }
        }
      }

      self.recognitionRequest?.append(buffer)
      resolve(nil)
    }
  }

  @objc func isEndpoint(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // Endpoint detection is driven externally by the VAD (OnDeviceASR.ts calls
    // resetASR when VAD transitions to silence). Always return false here.
    resolve(false)
  }

  @objc func getPartialResult(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // Partial results are delivered as events (onPartialResult); no polling needed.
    resolve("")
  }

  @objc func resetASR(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    asrQueue.async { [weak self] in
      guard let self = self else { resolve(nil); return }
      // endAudio() signals to the recognizer that no more audio is coming,
      // causing it to finalize and fire the completion with isFinal = true.
      self.recognitionRequest?.endAudio()
      self.recognitionRequest = nil
      self.recognitionTask?.cancel()
      self.recognitionTask = nil
      resolve(nil)
    }
  }

  @objc func releaseASR(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    asrQueue.async { [weak self] in
      guard let self = self else { resolve(nil); return }
      self.recognitionRequest?.endAudio()
      self.recognitionRequest = nil
      self.recognitionTask?.cancel()
      self.recognitionTask = nil
      self.speechRecognizer = nil
      self.isASRInitialized = false
      resolve(nil)
    }
  }

  // MARK: - Speaker Embedding
  // SFSpeechRecognizer does not expose speaker embeddings.
  // The methods below keep the JS API intact so the rest of the
  // pipeline compiles and runs; cosine-similarity matching falls
  // through to "Unknown" speaker when embeddings are all zeros.

  @objc func initSpeakerModel(
    _ config: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    isSpeakerInitialized = true
    resolve(nil)
  }

  @objc func extractEmbedding(
    _ base64Samples: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve([Float](repeating: 0, count: 256))
  }

  @objc func releaseSpeakerModel(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    isSpeakerInitialized = false
    resolve(nil)
  }

  // MARK: - Model Management

  @objc func modelsExist(
    _ paths: [String],
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    // SFSpeechRecognizer uses the built-in system model — no files to check.
    resolve(true)
  }
}
