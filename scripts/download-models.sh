#!/bin/bash

# Download Sherpa-ONNX Models Script
# This script downloads the necessary models for speech recognition and speaker identification using curl

set -e

echo "📦 Downloading Sherpa-ONNX Models..."

# Create models directory
mkdir -p models

# Download a lightweight ASR model (example: Zipformer transducer)
echo "Downloading ASR models..."
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-en-2023-06-26.tar.bz2"

cd models

if [ ! -f "encoder.onnx" ]; then
    echo "⬇️  Downloading Zipformer model..."

    # Download if tar file doesn't exist
    if [ ! -f "model.tar.bz2" ]; then
        # -L follows redirects, -o specifies output file, -# shows progress bar
        curl -L "$MODEL_URL" -o model.tar.bz2 -#
    fi

    # Extract
    tar -xjf model.tar.bz2

    # Move files from subdirectory
    mv sherpa-onnx-zipformer-en-2023-06-26/* .
    rm -rf sherpa-onnx-zipformer-en-2023-06-26

    # Create symlinks with expected names
    if [ -f "encoder-epoch-99-avg-1.onnx" ]; then
        ln -sf encoder-epoch-99-avg-1.onnx encoder.onnx
    fi
    if [ -f "decoder-epoch-99-avg-1.onnx" ]; then
        ln -sf decoder-epoch-99-avg-1.onnx decoder.onnx
    fi
    if [ -f "joiner-epoch-99-avg-1.onnx" ]; then
        ln -sf joiner-epoch-99-avg-1.onnx joiner.onnx
    fi

    # Clean up tar file
    rm -f model.tar.bz2

    echo "✅ ASR models downloaded and configured"
else
    echo "✅ ASR models already exist"
fi

# Download speaker embedding model
echo "Downloading speaker embedding model..."
SPEAKER_MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recognition-models/wespeaker_en_voxceleb_resnet34.onnx"

# Check if file exists and has valid size (should be ~40MB)
if [ -f "speaker-embedding.onnx" ]; then
    FILE_SIZE=$(stat -f%z "speaker-embedding.onnx" 2>/dev/null || stat -c%s "speaker-embedding.onnx" 2>/dev/null)
    if [ "$FILE_SIZE" -lt 1000000 ]; then
        echo "⚠️  Existing speaker-embedding.onnx is too small ($FILE_SIZE bytes), re-downloading..."
        rm -f speaker-embedding.onnx
    else
        echo "✅ Speaker embedding model already exists"
    fi
fi

if [ ! -f "speaker-embedding.onnx" ]; then
    echo "⬇️  Downloading speaker embedding model (this may take a minute)..."
    # curl -L for redirects, -o for output, -# for progress
    curl -L "$SPEAKER_MODEL_URL" -o speaker-embedding.onnx -#

    # Verify download
    FILE_SIZE=$(stat -f%z "speaker-embedding.onnx" 2>/dev/null || stat -c%s "speaker-embedding.onnx" 2>/dev/null)
    if [ "$FILE_SIZE" -lt 1000000 ]; then
        echo "❌ Download failed or incomplete (file size: $FILE_SIZE bytes)"
        rm -f speaker-embedding.onnx
        exit 1
    fi

    echo "✅ Speaker embedding model downloaded successfully ($FILE_SIZE bytes)"
fi

cd ..

echo ""
echo "🎉 All models downloaded successfully!"
echo ""
echo "Next steps:"
echo "  1. Prepare two .wav files (16kHz mono) - one for therapist, one for client"
echo "  2. Run enrollment: npm run enroll -- --therapist <path> --client <path>"
echo ""