import { createRequire } from "node:module";
import { defineConfig, loadEnv } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const require = createRequire(import.meta.url);

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      nodePolyfills({
        include: ["buffer", "path"],
        globals: { Buffer: true },
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
        ...(env.TEE_URL && {
          "/tee": {
            target: env.TEE_URL,
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/tee/, ""),
          },
        }),
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
      alias: {
        // Bun hoists vite-plugin-node-polyfills under .bun/ which Rollup can't
        // resolve when the plugin injects its buffer shim into SDK source files.
        // Only needed for production builds — dev mode resolves it via the plugin.
        ...(command === "build" && {
          "vite-plugin-node-polyfills/shims/buffer": require.resolve(
            "vite-plugin-node-polyfills/shims/buffer",
          ),
        }),
      },
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
