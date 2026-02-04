import ms from "ms";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: ms("10 min"),
  },
});
