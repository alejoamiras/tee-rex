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
    <div id="progress" class="hidden"></div>
    <span id="progress-text"></span>
    <span id="elapsed-time"></span>
    <section id="results" class="hidden"></section>
    <div id="result-local"></div>
    <div id="time-local"></div>
    <div id="tag-local"></div>
    <div id="result-remote"></div>
    <div id="time-remote"></div>
    <div id="tag-remote"></div>
    <div id="result-tee"></div>
    <div id="time-tee"></div>
    <div id="tag-tee"></div>
    <div id="log"></div>
    <span id="log-count"></span>
  `;
}
