#!/bin/bash

# Download Sherpa-ONNX Models Script
# This script downloads the necessary models for speech recognition and speaker identification

set -e

echo "📦 Downloading Sherpa-ONNX Models..."

# Create models directory
mkdir -p models

# Download a lightweight ASR model (example: Zipformer transducer)
# Note: Adjust URLs based on actual Sherpa-ONNX model repository
echo "Downloading ASR models..."
MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-en-2023-06-26.tar.bz2"

cd models

if [ ! -f "encoder.onnx" ]; then
    echo "⬇️  Downloading Zipformer model..."
    wget -q --show-progress "$MODEL_URL" -O model.tar.bz2
    tar -xjf model.tar.bz2
    mv sherpa-onnx-zipformer-en-2023-06-26/* .
    rm -rf sherpa-onnx-zipformer-en-2023-06-26 model.tar.bz2
    echo "✅ ASR models downloaded"
else
    echo "✅ ASR models already exist"
fi

# Download speaker embedding model
echo "Downloading speaker embedding model..."
SPEAKER_MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recognition-models/wespeaker_en_voxceleb_resnet34.onnx"

if [ ! -f "speaker-embedding.onnx" ]; then
    echo "⬇️  Downloading speaker embedding model..."
    wget -q --show-progress "$SPEAKER_MODEL_URL" -O speaker-embedding.onnx
    echo "✅ Speaker embedding model downloaded"
else
    echo "✅ Speaker embedding model already exists"
fi

cd ..

echo ""
echo "🎉 All models downloaded successfully!"
echo ""
echo "Next steps:"
echo "  1. Prepare two .wav files (16kHz mono) - one for therapist, one for client"
echo "  2. Run enrollment: npm run enroll -- --therapist <path> --client <path>"
echo ""
