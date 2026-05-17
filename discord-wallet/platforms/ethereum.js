// platforms/ethereum.js
// Works for any EVM chain: Ethereum, Base, Arbitrum, Polygon, BSC, etc.
// Just point `rpcUrl` at the right chain in your config.

import { ethers } from 'ethers';
import { makePlatform } from './base.js';

export function createEthereumPlatform({ rpcUrl, privateKey, explorerUrl }) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  return makePlatform({
    id: 'eth',
    name: 'Ethereum',
    symbol: 'ETH',

    async getAddress() {
      return wallet.address;
    },

    async getBalance() {
      const wei = await provider.getBalance(wallet.address);
      return { native: ethers.formatEther(wei) };
    },

    async send(to, amount) {
      if (!ethers.isAddress(to)) throw new Error('Invalid Ethereum address');
      const value = ethers.parseEther(String(amount));
      const tx = await wallet.sendTransaction({ to, value });
      return {
        hash: tx.hash,
        explorerUrl: `${explorerUrl.replace(/\/$/, '')}/tx/${tx.hash}`,
      };
    },

    validateAddress(addr) {
      return ethers.isAddress(addr);
    },
  });
}
