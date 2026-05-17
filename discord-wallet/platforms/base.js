// platforms/base.js
// Every platform module must implement this interface.
// A platform represents one chain (or service) the bot can talk to.

/**
 * @typedef {Object} Platform
 * @property {string} id            - short id, e.g. "eth", "sol"
 * @property {string} name          - display name, e.g. "Ethereum"
 * @property {string} symbol        - native token symbol, e.g. "ETH"
 * @property {() => Promise<string>} getAddress
 * @property {() => Promise<{native: string, [token: string]: string}>} getBalance
 * @property {(to: string, amount: string) => Promise<{hash: string, explorerUrl: string}>} send
 * @property {(addr: string) => boolean} validateAddress
 */

export function makePlatform(impl) {
  const required = ['id', 'name', 'symbol', 'getAddress', 'getBalance', 'send', 'validateAddress'];
  for (const k of required) {
    if (!(k in impl)) throw new Error(`Platform missing required field: ${k}`);
  }
  return impl;
}
