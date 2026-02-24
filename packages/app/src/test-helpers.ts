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
    <button id="mode-nitro" disabled></button>
    <button id="mode-sgx" disabled></button>
    <span id="nitro-status" class="status-dot status-unknown"></span>
    <span id="nitro-attestation-label"></span>
    <span id="nitro-url"></span>
    <span id="sgx-status" class="status-dot status-unknown"></span>
    <span id="sgx-attestation-label"></span>
    <span id="sgx-url"></span>
    <button id="deploy-btn" disabled></button>
    <button id="token-flow-btn" disabled></button>
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
    <div id="result-nitro"></div>
    <div id="time-nitro"></div>
    <div id="tag-nitro"></div>
    <div id="steps-nitro" class="hidden"></div>
    <div id="result-sgx"></div>
    <div id="time-sgx"></div>
    <div id="tag-sgx"></div>
    <div id="steps-sgx" class="hidden"></div>
    <div id="log"></div>
    <span id="log-count"></span>
  `;
}
