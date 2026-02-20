import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const require = createRequire(import.meta.url);

/**
 * Vite plugin: redirect bb.js worker file requests to their real location.
 *
 * Barretenberg (bb.js) spawns Web Workers via:
 *   new Worker(new URL('./main.worker.js', import.meta.url), { type: 'module' })
 *
 * When Vite's dep optimizer pre-bundles bb.js, import.meta.url changes to
 * point at `.vite/deps/` — but the worker files aren't copied there. This
 * causes a "file does not exist" error at runtime. (Vite bug #8427, fixed
 * in Vite 8 via PR #21434 — remove this plugin after upgrading to Vite 8.)
 *
 * We can't just add bb.js to optimizeDeps.exclude because other pre-bundled
 * @aztec chunks import it, causing cascading resolution failures. Instead,
 * this plugin intercepts the broken worker requests and serves the files
 * from their original location in node_modules.
 */
function bbWorkerPlugin(): Plugin {
  const workerFiles: Record<string, string> = {};

  return {
    name: "bb-worker-redirect",
    configResolved(config) {
      // Resolve the actual worker file paths once at startup.
      // bb.js is a transitive dep hoisted by Bun — resolve its entry via bb-prover,
      // then extract the package root from the path (contains "@aztec/bb.js/").
      try {
        const bbProverPath = require.resolve("@aztec/bb-prover");
        const bbRequire = createRequire(bbProverPath);
        const bbEntry = bbRequire.resolve("@aztec/bb.js");
        const bbRoot = bbEntry.slice(0, bbEntry.indexOf("@aztec/bb.js/") + "@aztec/bb.js/".length);
        const bbBrowserDir = resolve(bbRoot, "dest", "browser", "barretenberg_wasm");
        workerFiles["main.worker.js"] = resolve(
          bbBrowserDir,
          "barretenberg_wasm_main",
          "factory",
          "browser",
          "main.worker.js",
        );
        workerFiles["thread.worker.js"] = resolve(
          bbBrowserDir,
          "barretenberg_wasm_thread",
          "factory",
          "browser",
          "thread.worker.js",
        );
        config.logger.info(`[bb-worker-redirect] Resolved worker files in ${bbBrowserDir}`);
      } catch (err) {
        config.logger.warn(`[bb-worker-redirect] Could not resolve @aztec/bb.js workers: ${err}`);
      }
    },
    configureServer(server) {
      // Intercept requests for worker files that Vite can't find in .vite/deps/
      server.middlewares.use((req, _res, next) => {
        if (!req.url) return next();

        for (const [filename, realPath] of Object.entries(workerFiles)) {
          if (req.url.includes(filename) && req.url.includes(".vite/deps")) {
            // Rewrite the URL to serve the file from its real location via Vite's /@fs/ prefix
            req.url = `/@fs/${realPath}`;
            break;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  // Load all env vars for config use (proxy targets). Only AZTEC_NODE_URL, PROVER_URL,
  // and TEE_URL are exposed to the browser via the explicit `define` block below.
  const allEnv = loadEnv(mode, process.cwd(), "");
  const env = {
    AZTEC_NODE_URL: allEnv.AZTEC_NODE_URL,
    PROVER_URL: allEnv.PROVER_URL,
    TEE_URL: allEnv.TEE_URL,
    VITE_ENV_NAME: allEnv.VITE_ENV_NAME,
  };
  return {
    plugins: [
      nodePolyfills({
        include: ["buffer", "path"],
        globals: { Buffer: true },
      }),
      bbWorkerPlugin(),
    ],
    // Exclude packages that use WASM or Web Workers from pre-bundling.
    // - noir packages: `new URL('*.wasm', import.meta.url)` pattern needs raw paths.
    // - bb.js workers are handled by bbWorkerPlugin() above.
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
        ...(env.PROVER_URL && {
          "/prover": {
            target: env.PROVER_URL,
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/prover/, ""),
          },
        }),
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
        TEE_URL: env.TEE_URL,
        E2E_RETRY_STALE_HEADER: env.E2E_RETRY_STALE_HEADER,
        VITE_ENV_NAME: env.VITE_ENV_NAME,
      }),
    },
  };
});
