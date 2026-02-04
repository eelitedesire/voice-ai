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
    LIBRARY_PATH_VAR="DYLD_LIBRARY_PATH"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    ARCH=$(uname -m)
    if [ "$ARCH" = "aarch64" ]; then
        PLATFORM_PKG="sherpa-onnx-linux-arm64"
    else
        PLATFORM_PKG="sherpa-onnx-linux-x64"
    fi
    LIBRARY_PATH_VAR="LD_LIBRARY_PATH"
else
    # Windows or other - just run without setting path
    exec "$@"
    exit $?
fi

# Set the library path
ADDON_PATH="$PROJECT_ROOT/node_modules/$PLATFORM_PKG"

if [ -d "$ADDON_PATH" ]; then
    export $LIBRARY_PATH_VAR="$ADDON_PATH:${!LIBRARY_PATH_VAR}"
    # echo "Set $LIBRARY_PATH_VAR=$ADDON_PATH" >&2
fi

# Run the command
exec "$@"
