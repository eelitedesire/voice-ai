#!/bin/bash

# Download Sherpa-ONNX Models Script
# This script downloads the necessary models for speech recognition and speaker identification

set -e

echo "📦 Downloading Sherpa-ONNX Models..."

# Create models directory
mkdir -p models
cd models

echo ""
echo "==================================================================="
echo "Downloading ASR Models (Speech Recognition)"
echo "==================================================================="

# Download ASR model - Zipformer for English
ASR_MODEL_NAME="sherpa-onnx-zipformer-en-2023-06-26"
ASR_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${ASR_MODEL_NAME}.tar.bz2"

if [ ! -f "encoder-epoch-99-avg-1.onnx" ]; then
    echo "⬇️  Downloading Zipformer ASR model..."
    curl -SL -O "$ASR_URL"

    echo "📦 Extracting ASR model..."
    tar xf "${ASR_MODEL_NAME}.tar.bz2"

    # Move files from subdirectory to models root
    if [ -d "$ASR_MODEL_NAME" ]; then
        mv "${ASR_MODEL_NAME}"/* .
        rmdir "$ASR_MODEL_NAME"
    fi

    # Clean up tar file
    rm -f "${ASR_MODEL_NAME}.tar.bz2"

    echo "✅ ASR model downloaded and extracted"
else
    echo "✅ ASR model already exists"
fi

# Create symlinks for easier access
echo "🔗 Creating symlinks..."
if [ -f "encoder-epoch-99-avg-1.onnx" ] && [ ! -L "encoder.onnx" ]; then
    ln -sf encoder-epoch-99-avg-1.onnx encoder.onnx
    echo "   ✅ encoder.onnx -> encoder-epoch-99-avg-1.onnx"
fi

if [ -f "decoder-epoch-99-avg-1.onnx" ] && [ ! -L "decoder.onnx" ]; then
    ln -sf decoder-epoch-99-avg-1.onnx decoder.onnx
    echo "   ✅ decoder.onnx -> decoder-epoch-99-avg-1.onnx"
fi

if [ -f "joiner-epoch-99-avg-1.onnx" ] && [ ! -L "joiner.onnx" ]; then
    ln -sf joiner-epoch-99-avg-1.onnx joiner.onnx
    echo "   ✅ joiner.onnx -> joiner-epoch-99-avg-1.onnx"
fi

echo ""
echo "==================================================================="
echo "Downloading Speaker Embedding Model"
echo "==================================================================="

# Download speaker embedding model - WeSpeaker ResNet34
SPEAKER_MODEL="wespeaker_en_voxceleb_resnet34.onnx"
SPEAKER_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recognition-models/${SPEAKER_MODEL}"

# Check if file exists and validate size
if [ -f "$SPEAKER_MODEL" ]; then
    FILE_SIZE=$(stat -f%z "$SPEAKER_MODEL" 2>/dev/null || stat -c%s "$SPEAKER_MODEL" 2>/dev/null)
    if [ "$FILE_SIZE" -lt 30000000 ]; then
        echo "⚠️  Existing $SPEAKER_MODEL is too small ($(($FILE_SIZE / 1024 / 1024)) MB)"
        echo "    Expected: ~40MB. Re-downloading..."
        rm -f "$SPEAKER_MODEL"
    else
        echo "✅ Speaker embedding model already exists ($(($FILE_SIZE / 1024 / 1024)) MB)"
    fi
fi

if [ ! -f "$SPEAKER_MODEL" ]; then
    echo "⬇️  Downloading speaker embedding model..."
    curl -SL -O "$SPEAKER_URL"

    # Verify download
    if [ -f "$SPEAKER_MODEL" ]; then
        FILE_SIZE=$(stat -f%z "$SPEAKER_MODEL" 2>/dev/null || stat -c%s "$SPEAKER_MODEL" 2>/dev/null)
        if [ "$FILE_SIZE" -lt 30000000 ]; then
            echo "❌ Download failed - file too small ($(($FILE_SIZE / 1024 / 1024)) MB)"
            rm -f "$SPEAKER_MODEL"
            exit 1
        fi
        echo "✅ Speaker embedding model downloaded ($(($FILE_SIZE / 1024 / 1024)) MB)"
    else
        echo "❌ Download failed - file not created"
        exit 1
    fi
fi

# Create symlink for consistency
if [ ! -L "speaker-embedding.onnx" ]; then
    ln -sf "$SPEAKER_MODEL" speaker-embedding.onnx
    echo "🔗 speaker-embedding.onnx -> $SPEAKER_MODEL"
fi

echo ""
echo "==================================================================="
echo "Downloading VAD Model (Voice Activity Detection)"
echo "==================================================================="

# Download VAD model - Silero VAD
VAD_MODEL="silero_vad.onnx"
VAD_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${VAD_MODEL}"

if [ ! -f "$VAD_MODEL" ]; then
    echo "⬇️  Downloading VAD model..."
    curl -SL -O "$VAD_URL"

    # Verify download
    if [ -f "$VAD_MODEL" ]; then
        FILE_SIZE=$(stat -f%z "$VAD_MODEL" 2>/dev/null || stat -c%s "$VAD_MODEL" 2>/dev/null)
        if [ "$FILE_SIZE" -lt 100000 ]; then
            echo "❌ Download failed - file too small"
            rm -f "$VAD_MODEL"
            exit 1
        fi
        echo "✅ VAD model downloaded ($(($FILE_SIZE / 1024)) KB)"
    else
        echo "❌ Download failed - file not created"
        exit 1
    fi
else
    echo "✅ VAD model already exists"
fi

cd ..

echo ""
echo "==================================================================="
echo "✅ All models downloaded successfully!"
echo "==================================================================="
echo ""
echo "Models downloaded:"
echo "  • ASR (Speech Recognition): Zipformer English"
echo "  • Speaker Embedding: WeSpeaker ResNet34"
echo "  • VAD: Silero VAD"
echo ""
echo "Next steps:"
echo "  1. Verify setup: npm run verify"
echo "  2. Enroll speakers: npm run enroll"
echo ""
