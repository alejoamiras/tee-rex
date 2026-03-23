import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDOM } from "./test-helpers";
import { $ } from "./ui";
import {
  hideWalletSelection,
  initWalletSelection,
  showWalletSelection,
  wireWalletSelectionListeners,
} from "./wallet-selection";

describe("wallet-selection", () => {
  beforeEach(() => setupDOM());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("showWalletSelection / hideWalletSelection", () => {
    test("showWalletSelection removes hidden from wallet-selection, adds hidden to embedded-ui and external-ui", () => {
      // embedded-ui and external-ui start hidden in setupDOM, wallet-selection starts hidden
      $("embedded-ui").classList.remove("hidden");
      $("external-ui").classList.remove("hidden");

      showWalletSelection();

      expect($("wallet-selection").classList.contains("hidden")).toBe(false);
      expect($("embedded-ui").classList.contains("hidden")).toBe(true);
      expect($("external-ui").classList.contains("hidden")).toBe(true);
    });

    test("hideWalletSelection adds hidden to wallet-selection", () => {
      $("wallet-selection").classList.remove("hidden");
      hideWalletSelection();
      expect($("wallet-selection").classList.contains("hidden")).toBe(true);
    });
  });

  describe("initWalletSelection", () => {
    test("enables embedded button when nodeReady is true", () => {
      const onChooseEmbedded = mock();
      const onChooseExternal = mock();
      const log = mock();

      initWalletSelection({
        nodeReady: true,
        chainInfo: null,
        callbacks: { onChooseEmbedded, onChooseExternal },
        log,
      });

      expect(($("choose-embedded-btn") as HTMLButtonElement).disabled).toBe(false);
    });

    test("disables embedded button when nodeReady is false", () => {
      const onChooseEmbedded = mock();
      const onChooseExternal = mock();
      const log = mock();

      initWalletSelection({
        nodeReady: false,
        chainInfo: null,
        callbacks: { onChooseEmbedded, onChooseExternal },
        log,
      });

      expect(($("choose-embedded-btn") as HTMLButtonElement).disabled).toBe(true);
    });

    test("shows wallet-selection and resets discovery section to hidden", () => {
      const onChooseEmbedded = mock();
      const onChooseExternal = mock();
      const log = mock();

      initWalletSelection({
        nodeReady: false,
        chainInfo: null,
        callbacks: { onChooseEmbedded, onChooseExternal },
        log,
      });

      expect($("wallet-selection").classList.contains("hidden")).toBe(false);
      expect($("ext-discovery-section").classList.contains("hidden")).toBe(true);
      expect($("choose-external-btn").classList.contains("hidden")).toBe(false);
    });
  });

  describe("wireWalletSelectionListeners", () => {
    // One-shot guard: wireWalletSelectionListeners only runs once per module load.
    // All listener assertions must go in a single test block.
    test("embedded click → onChooseEmbedded, external click → discovery shown, cancel → choice restored", () => {
      const onChooseEmbedded = mock();
      const onChooseExternal = mock();
      const log = mock();

      initWalletSelection({
        nodeReady: true,
        chainInfo: null,
        callbacks: { onChooseEmbedded, onChooseExternal },
        log,
      });

      wireWalletSelectionListeners();

      // 1. Embedded button click calls onChooseEmbedded
      $("choose-embedded-btn").click();
      expect(onChooseEmbedded).toHaveBeenCalledTimes(1);

      // 2. External button click shows discovery section and hides the choice button
      $("choose-external-btn").click();
      expect($("ext-discovery-section").classList.contains("hidden")).toBe(false);
      expect($("choose-external-btn").classList.contains("hidden")).toBe(true);
      // With chainInfo: null, search status shows unavailable message
      expect($("ext-wallet-search-status").textContent).toContain("Aztec node unavailable");

      // 3. Cancel click hides discovery and restores choice buttons
      $("ext-cancel-discovery-btn").click();
      expect($("ext-discovery-section").classList.contains("hidden")).toBe(true);
      expect($("choose-external-btn").classList.contains("hidden")).toBe(false);
    });
  });
});
