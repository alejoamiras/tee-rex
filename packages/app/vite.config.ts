import { defineConfig, loadEnv } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      nodePolyfills({
        include: ["buffer", "path"],
      }),
    ],
    // Exclude WASM-containing packages from pre-bundling so their
    // `new URL('*.wasm', import.meta.url)` pattern resolves correctly.
    optimizeDeps: {
      exclude: ["@aztec/noir-acvm_js", "@aztec/noir-noirc_abi"],
    },
    server: {
      headers: {
        // COOP/COEP enable SharedArrayBuffer for multi-threaded WASM.
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      },
      proxy: {
        // Aztec node has no CORS headers — proxy through Vite
        "/aztec": {
          target: env.AZTEC_NODE_URL || "http://localhost:8080",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/aztec/, ""),
        },
        "/prover": {
          target: env.PROVER_URL || "http://localhost:4000",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/prover/, ""),
        },
      },
      fs: {
        // Allow serving files from the monorepo root (WASM files in node_modules)
        allow: ["../.."],
      },
    },
    build: {
      target: "esnext",
    },
    resolve: {
      // Ensure single class instances for instanceof checks across packages
      dedupe: ["@aztec/bb-prover"],
    },
    define: {
      "process.env": JSON.stringify({
        AZTEC_NODE_URL: env.AZTEC_NODE_URL,
        PROVER_URL: env.PROVER_URL,
      }),
    },
  };
});
