// platforms/solana.js

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { makePlatform } from './base.js';

function keypairFromSecret(secretBase64) {
  const bytes = Buffer.from(secretBase64, 'base64');
  return Keypair.fromSecretKey(new Uint8Array(bytes));
}

export function createSolanaPlatform({ rpcUrl, secretKey, explorerUrl }) {
  const connection = new Connection(rpcUrl, 'confirmed');
  const keypair = keypairFromSecret(secretKey);

  return makePlatform({
    id: 'sol',
    name: 'Solana',
    symbol: 'SOL',

    async getAddress() {
      return keypair.publicKey.toBase58();
    },

    async getBalance() {
      const lamports = await connection.getBalance(keypair.publicKey);
      return { native: (lamports / LAMPORTS_PER_SOL).toFixed(9) };
    },

    async send(to, amount) {
      let toPubkey;
      try {
        toPubkey = new PublicKey(to);
      } catch {
        throw new Error('Invalid Solana address');
      }
      const lamports = Math.round(Number(amount) * LAMPORTS_PER_SOL);
      if (!Number.isFinite(lamports) || lamports <= 0) {
        throw new Error('Invalid amount');
      }
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey,
          lamports,
        })
      );
      const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      return {
        hash: sig,
        explorerUrl: `${explorerUrl.replace(/\/$/, '')}/tx/${sig}`,
      };
    },

    validateAddress(addr) {
      try {
        new PublicKey(addr);
        return true;
      } catch {
        return false;
      }
    },
  });
}
