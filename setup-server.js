// setup-server.js
// Local Express server that serves the setup wizard GUI and handles
// wallet generation + saving the encrypted config.
//
// Run: npm run setup
// Open: http://localhost:7866

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import open from 'open';
import * as bip39 from 'bip39';
import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';

import { saveConfig, configExists } from './lib/wallet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = 7866;

// Generate a fresh wallet (single BIP-39 mnemonic, both EVM + Solana derived)
app.post('/api/generate-wallet', (_req, res) => {
  const mnemonic = bip39.generateMnemonic(256); // 24 words

  // EVM (Ethereum etc.) — standard derivation path m/44'/60'/0'/0/0
  const evmWallet = ethers.HDNodeWallet.fromPhrase(mnemonic);

  // Solana — derive from mnemonic seed
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const solKeypair = Keypair.fromSeed(seed.subarray(0, 32));

  res.json({
    mnemonic,
    evm: { address: evmWallet.address, privateKey: evmWallet.privateKey },
    sol: {
      address: solKeypair.publicKey.toBase58(),
      secretKey: Buffer.from(solKeypair.secretKey).toString('base64'),
    },
  });
});

// Import from existing mnemonic
app.post('/api/import-wallet', (req, res) => {
  const { mnemonic } = req.body || {};
  if (!mnemonic || !bip39.validateMnemonic(mnemonic.trim())) {
    return res.status(400).json({ error: 'Invalid BIP-39 mnemonic' });
  }
  const m = mnemonic.trim();
  const evmWallet = ethers.HDNodeWallet.fromPhrase(m);
  const seed = bip39.mnemonicToSeedSync(m);
  const solKeypair = Keypair.fromSeed(seed.subarray(0, 32));
  res.json({
    mnemonic: m,
    evm: { address: evmWallet.address, privateKey: evmWallet.privateKey },
    sol: {
      address: solKeypair.publicKey.toBase58(),
      secretKey: Buffer.from(solKeypair.secretKey).toString('base64'),
    },
  });
});

// Save the encrypted config
app.post('/api/save', (req, res) => {
  const { password, config } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!config) return res.status(400).json({ error: 'Missing config' });
  try {
    saveConfig(config, password);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({ configExists: configExists() });
});

app.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  setup wizard running at ${url}\n`);
  try {
    await open(url);
  } catch {
    /* user can open manually */
  }
});
