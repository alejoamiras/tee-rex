import { describe, expect, mock, test } from "bun:test";
import { lazyValue } from "./utils.js";

describe("lazyValue", () => {
  test("returns the value from the factory function", () => {
    const getValue = lazyValue(() => 42);
    expect(getValue()).toBe(42);
  });

  test("calls factory only once", () => {
    const factory = mock(() => "hello");
    const getValue = lazyValue(factory);

    getValue();
    getValue();
    getValue();

    expect(factory).toHaveBeenCalledTimes(1);
  });

  test("returns the same reference on subsequent calls", () => {
    const obj = { key: "value" };
    const getValue = lazyValue(() => obj);

    const first = getValue();
    const second = getValue();

    expect(first).toBe(second);
    expect(first).toBe(obj);
  });

  test("works with async factory functions", async () => {
    const getValue = lazyValue(async () => "async-result");
    const result = await getValue();
    expect(result).toBe("async-result");
  });

  test("propagates errors from factory", () => {
    const getValue = lazyValue(() => {
      throw new Error("factory failed");
    });
    expect(() => getValue()).toThrow("factory failed");
  });
});
