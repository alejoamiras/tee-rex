import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type AccountEntry,
  hideExternalUI,
  initExternalWalletUI,
  populateExternalWalletUI,
  showExternalUI,
} from "./external-wallet-ui";
import { setupDOM } from "./test-helpers";
import { $ } from "./ui";

function acct(address: string, alias?: string): AccountEntry {
  return { address, alias };
}

describe("external-wallet-ui", () => {
  beforeEach(() => setupDOM());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("showExternalUI / hideExternalUI", () => {
    test("showExternalUI removes hidden class", () => {
      expect($("external-ui").classList.contains("hidden")).toBe(true);
      showExternalUI();
      expect($("external-ui").classList.contains("hidden")).toBe(false);
    });

    test("hideExternalUI adds hidden class", () => {
      $("external-ui").classList.remove("hidden");
      hideExternalUI();
      expect($("external-ui").classList.contains("hidden")).toBe(true);
    });
  });

  describe("populateExternalWalletUI", () => {
    test("sets network dot to online", () => {
      populateExternalWalletUI("TestWallet", undefined, [acct("0x1234")]);
      expect($("ext-network-dot").className).toBe("status-dot status-online");
    });

    test("sets network label to local sandbox when ENV_NAME is undefined", () => {
      populateExternalWalletUI("TestWallet", undefined, [acct("0x1234")]);
      expect($("ext-network-label").textContent).toBe("local sandbox");
    });

    test("sets wallet name", () => {
      populateExternalWalletUI("MyWallet", undefined, [acct("0x1234")]);
      expect($("ext-wallet-name").textContent).toBe("MyWallet");
    });

    test("shows wallet icon and hides placeholder when icon URL provided", () => {
      populateExternalWalletUI("W", "https://example.com/icon.png", [acct("0x1234")]);
      const icon = $("ext-wallet-icon") as HTMLImageElement;
      expect(icon.src).toBe("https://example.com/icon.png");
      expect(icon.classList.contains("hidden")).toBe(false);
      expect($("ext-wallet-icon-placeholder").classList.contains("hidden")).toBe(true);
    });

    test("hides icon and shows placeholder when no icon", () => {
      populateExternalWalletUI("W", undefined, [acct("0x1234")]);
      expect($("ext-wallet-icon").classList.contains("hidden")).toBe(true);
      expect($("ext-wallet-icon-placeholder").classList.contains("hidden")).toBe(false);
    });

    test("shows truncated address for single account without alias", () => {
      populateExternalWalletUI("W", undefined, [acct("0xabcdef1234567890abcdef")]);
      const selector = $("ext-account-selector");
      const address = $("ext-wallet-address");
      expect(selector.classList.contains("hidden")).toBe(true);
      expect(address.classList.contains("hidden")).toBe(false);
      expect(address.textContent).toBe("0xabcdef1234567890ab...");
    });

    test("shows alias instead of address for single account with alias", () => {
      populateExternalWalletUI("W", undefined, [acct("0xabcdef1234567890abcdef", "my-account")]);
      const address = $("ext-wallet-address");
      expect(address.textContent).toBe("my-account");
    });

    test("shows aliases in selector for multiple accounts", () => {
      populateExternalWalletUI("W", undefined, [acct("0xaaaa", "Alice"), acct("0xbbbb", "Bob")]);
      const selector = $("ext-account-selector") as HTMLSelectElement;
      expect(selector.classList.contains("hidden")).toBe(false);
      expect(selector.options.length).toBe(2);
      expect(selector.options[0].textContent).toBe("Alice");
      expect(selector.options[1].textContent).toBe("Bob");
      // value is still the address
      expect(selector.options[0].value).toBe("0xaaaa");
      expect(selector.options[1].value).toBe("0xbbbb");
    });

    test("falls back to truncated address when alias is missing in selector", () => {
      populateExternalWalletUI("W", undefined, [
        acct("0xaaaa1111222233334444aabb"),
        acct("0xbbbb5555666677778888ccdd", "Bob"),
      ]);
      const selector = $("ext-account-selector") as HTMLSelectElement;
      expect(selector.options[0].textContent).toBe("0xaaaa11112222333344...");
      expect(selector.options[1].textContent).toBe("Bob");
    });

    test("enables action buttons", () => {
      const deployBtn = $("ext-deploy-token-btn") as HTMLButtonElement;
      const flowBtn = $("ext-token-flow-btn") as HTMLButtonElement;
      expect(deployBtn.disabled).toBe(true);
      expect(flowBtn.disabled).toBe(true);

      populateExternalWalletUI("W", undefined, [acct("0x1234")]);

      expect(deployBtn.disabled).toBe(false);
      expect(flowBtn.disabled).toBe(false);
    });
  });

  describe("initExternalWalletUI", () => {
    test("disconnect button click triggers onSwitchWallet", () => {
      const onSwitchWallet = mock();
      const log = mock();
      initExternalWalletUI({ log, onSwitchWallet });

      $("ext-disconnect-btn").click();
      expect(onSwitchWallet).toHaveBeenCalledTimes(1);
    });

    test("account selector change triggers log with account info", () => {
      const onSwitchWallet = mock();
      const log = mock();

      // Populate with 2 accounts first to create options
      populateExternalWalletUI("W", undefined, [
        acct("0xaaaa1111222233334444", "Alice"),
        acct("0xbbbb5555666677778888", "Bob"),
      ]);

      initExternalWalletUI({ log, onSwitchWallet });

      const selector = $("ext-account-selector") as HTMLSelectElement;
      selector.selectedIndex = 1;
      selector.dispatchEvent(new Event("change"));

      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toContain("Switched to account 2");
    });
  });
});
