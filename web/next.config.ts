import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The model and the onnxruntime binaries are content-stable and large, so let the
        // browser keep them rather than revalidating a 21 MB download on every visit.
        source: "/:path(model|ort)/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
