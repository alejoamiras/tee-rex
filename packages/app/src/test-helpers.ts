/**
 * Insert the minimal DOM fixture needed by ui.ts and main.ts functions.
 * Call in beforeEach and pair with document.body.innerHTML = "" in afterEach.
 */
export function setupDOM(): void {
  document.body.innerHTML = `
    <span id="clock"></span>
    <span id="aztec-status" class="status-dot status-unknown"></span>
    <span id="teerex-status" class="status-dot status-unknown"></span>
    <span id="teerex-label"></span>
    <span id="wallet-dot" class="status-dot status-unknown"></span>
    <span id="wallet-state"></span>
    <button id="mode-local"></button>
    <button id="mode-remote" disabled></button>
    <button id="mode-tee" disabled></button>
    <span id="tee-status" class="status-dot status-unknown"></span>
    <span id="tee-attestation-label"></span>
    <span id="tee-url"></span>
    <button id="deploy-btn" disabled></button>
    <button id="token-flow-btn" disabled></button>
    <div id="switch-to-external-wrapper" class="hidden">
      <button id="switch-to-external-btn"></button>
    </div>
    <div id="progress" class="hidden">
      <pre id="ascii-art" class="ascii-art"></pre>
    </div>
    <section id="results" class="hidden"></section>
    <div id="result-local"></div>
    <div id="time-local"></div>
    <div id="tag-local"></div>
    <div id="steps-local" class="hidden"></div>
    <div id="result-remote"></div>
    <div id="time-remote"></div>
    <div id="tag-remote"></div>
    <div id="steps-remote" class="hidden"></div>
    <div id="result-tee"></div>
    <div id="time-tee"></div>
    <div id="tag-tee"></div>
    <div id="steps-tee" class="hidden"></div>
    <div id="log"></div>
    <span id="log-count"></span>
    <!-- Wallet selection -->
    <section id="wallet-selection" class="hidden"></section>
    <button id="choose-embedded-btn" disabled></button>
    <button id="choose-external-btn"></button>
    <div id="ext-discovery-section" class="hidden">
      <div id="ext-wallet-list"></div>
      <div id="ext-wallet-search-status"></div>
      <button id="ext-cancel-discovery-btn"></button>
      <div id="ext-emoji-section" class="hidden"></div>
      <div id="ext-emoji-grid"></div>
      <button id="ext-emoji-confirm-btn"></button>
      <button id="ext-emoji-reject-btn"></button>
    </div>
    <!-- Embedded / External UI wrappers -->
    <div id="embedded-ui" class="hidden"></div>
    <div id="external-ui" class="hidden"></div>
    <!-- External wallet UI -->
    <span id="ext-network-dot" class="status-dot status-unknown"></span>
    <span id="ext-network-label"></span>
    <img id="ext-wallet-icon" class="hidden" alt="" />
    <span id="ext-wallet-icon-placeholder" class="status-dot bg-cyan-700"></span>
    <span id="ext-wallet-name"></span>
    <select id="ext-account-selector" class="hidden"></select>
    <span id="ext-wallet-address"></span>
    <button id="ext-disconnect-btn"></button>
    <button id="ext-deploy-token-btn" disabled></button>
    <button id="ext-token-flow-btn" disabled></button>
    <div id="ext-progress" class="hidden">
      <pre id="ext-ascii-art" class="ascii-art"></pre>
    </div>
    <section id="ext-results" class="hidden"></section>
    <div id="ext-result-wallet"></div>
    <div id="ext-time-wallet"></div>
    <div id="ext-tag-wallet"></div>
    <div id="ext-steps-wallet" class="hidden"></div>
  `;
}
