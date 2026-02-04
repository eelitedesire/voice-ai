#!/bin/bash

# Fix Models Script
# This script fixes common issues with the models directory

set -e

echo "🔧 Fixing models directory..."

cd models

# Create symlinks for epoch-named files
echo "Creating symlinks for model files..."

if [ -f "encoder-epoch-99-avg-1.onnx" ] && [ ! -f "encoder.onnx" ]; then
    ln -sf encoder-epoch-99-avg-1.onnx encoder.onnx
    echo "✅ Created encoder.onnx symlink"
elif [ -f "encoder.onnx" ]; then
    echo "✅ encoder.onnx already exists"
fi

if [ -f "decoder-epoch-99-avg-1.onnx" ] && [ ! -f "decoder.onnx" ]; then
    ln -sf decoder-epoch-99-avg-1.onnx decoder.onnx
    echo "✅ Created decoder.onnx symlink"
elif [ -f "decoder.onnx" ]; then
    echo "✅ decoder.onnx already exists"
fi

if [ -f "joiner-epoch-99-avg-1.onnx" ] && [ ! -f "joiner.onnx" ]; then
    ln -sf joiner-epoch-99-avg-1.onnx joiner.onnx
    echo "✅ Created joiner.onnx symlink"
elif [ -f "joiner.onnx" ]; then
    echo "✅ joiner.onnx already exists"
fi

# Check and fix speaker embedding model
echo ""
echo "Checking speaker embedding model..."

SPEAKER_MODEL_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recognition-models/wespeaker_en_voxceleb_resnet34.onnx"

if [ -f "speaker-embedding.onnx" ]; then
    FILE_SIZE=$(stat -f%z "speaker-embedding.onnx" 2>/dev/null || stat -c%s "speaker-embedding.onnx" 2>/dev/null)
    if [ "$FILE_SIZE" -lt 1000000 ]; then
        echo "⚠️  speaker-embedding.onnx is corrupted ($FILE_SIZE bytes)"
        echo "⬇️  Re-downloading speaker embedding model..."
        rm -f speaker-embedding.onnx
        curl -L "$SPEAKER_MODEL_URL" -o speaker-embedding.onnx -#

        # Verify download
        FILE_SIZE=$(stat -f%z "speaker-embedding.onnx" 2>/dev/null || stat -c%s "speaker-embedding.onnx" 2>/dev/null)
        if [ "$FILE_SIZE" -lt 1000000 ]; then
            echo "❌ Download failed"
            exit 1
        fi
        echo "✅ Speaker embedding model fixed ($FILE_SIZE bytes)"
    else
        echo "✅ speaker-embedding.onnx is valid ($(($FILE_SIZE / 1024 / 1024)) MB)"
    fi
else
    echo "⬇️  Downloading speaker embedding model..."
    curl -L "$SPEAKER_MODEL_URL" -o speaker-embedding.onnx -#

    # Verify download
    FILE_SIZE=$(stat -f%z "speaker-embedding.onnx" 2>/dev/null || stat -c%s "speaker-embedding.onnx" 2>/dev/null)
    if [ "$FILE_SIZE" -lt 1000000 ]; then
        echo "❌ Download failed"
        exit 1
    fi
    echo "✅ Speaker embedding model downloaded ($FILE_SIZE bytes)"
fi

# Clean up subdirectory if it exists
if [ -d "sherpa-onnx-zipformer-en-2023-06-26" ]; then
    echo ""
    echo "Cleaning up extracted subdirectory..."
    rm -rf sherpa-onnx-zipformer-en-2023-06-26
    echo "✅ Subdirectory removed"
fi

cd ..

echo ""
echo "🎉 Models directory fixed!"
echo ""
echo "Running verification..."
npm run verify
