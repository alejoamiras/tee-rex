import { defineConfig, loadEnv } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      nodePolyfills({
        include: ["buffer", "path", "process", "net", "tty", "util", "stream", "events", "crypto"],
      }),
    ],
    server: {
      headers: {
        // Required for SharedArrayBuffer (bb.js multi-threaded WASM)
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      },
      proxy: {
        // Aztec node has no CORS headers — proxy through Vite
        "/aztec": {
          target: "http://localhost:8080",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/aztec/, ""),
        },
      },
      fs: {
        allow: [".."],
      },
    },
    build: {
      target: "esnext",
    },
    define: {
      "process.env": JSON.stringify({
        AZTEC_NODE_URL: env.AZTEC_NODE_URL,
      }),
    },
  };
});
