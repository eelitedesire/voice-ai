import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Don't bundle native modules - treat them as external
      config.externals = config.externals || [];
      config.externals.push({
        'sherpa-onnx-node': 'commonjs sherpa-onnx-node',
        'sherpa-onnx-darwin-arm64': 'commonjs sherpa-onnx-darwin-arm64',
        'sherpa-onnx-darwin-x64': 'commonjs sherpa-onnx-darwin-x64',
        'sherpa-onnx-linux-x64': 'commonjs sherpa-onnx-linux-x64',
        'sherpa-onnx-linux-arm64': 'commonjs sherpa-onnx-linux-arm64',
        'sherpa-onnx-win-x64': 'commonjs sherpa-onnx-win-x64',
        'sherpa-onnx-win-ia32': 'commonjs sherpa-onnx-win-ia32',
      });
    }
    return config;
  },
};

export default nextConfig;
