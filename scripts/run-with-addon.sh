#!/bin/bash

# Run script with proper native addon library path
# This sets DYLD_LIBRARY_PATH (macOS) or LD_LIBRARY_PATH (Linux) automatically

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Detect platform
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
        PLATFORM_PKG="sherpa-onnx-darwin-arm64"
    else
        PLATFORM_PKG="sherpa-onnx-darwin-x64"
    fi

    # Set DYLD_LIBRARY_PATH for macOS
    ADDON_PATH="$PROJECT_ROOT/node_modules/$PLATFORM_PKG"
    if [ -d "$ADDON_PATH" ]; then
        export DYLD_LIBRARY_PATH="$ADDON_PATH:$DYLD_LIBRARY_PATH"
    fi

elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    ARCH=$(uname -m)
    if [ "$ARCH" = "aarch64" ]; then
        PLATFORM_PKG="sherpa-onnx-linux-arm64"
    else
        PLATFORM_PKG="sherpa-onnx-linux-x64"
    fi

    # Set LD_LIBRARY_PATH for Linux
    ADDON_PATH="$PROJECT_ROOT/node_modules/$PLATFORM_PKG"
    if [ -d "$ADDON_PATH" ]; then
        export LD_LIBRARY_PATH="$ADDON_PATH:$LD_LIBRARY_PATH"
    fi
fi

# Run the command directly (without exec) to preserve environment
"$@"
