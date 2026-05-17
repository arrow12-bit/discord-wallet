// lib/wallet.js
// Loads and saves the encrypted configuration file.

import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from './crypto.js';

const CONFIG_PATH = path.resolve(process.cwd(), 'config', 'wallet.enc.json');

export function configExists() {
  return fs.existsSync(CONFIG_PATH);
}

export function saveConfig(config, password) {
  const blob = encrypt(JSON.stringify(config, null, 2), password);
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(blob, null, 2), 'utf8');
}

export function loadConfig(password) {
  if (!configExists()) {
    throw new Error('No config file found. Run `npm run setup` first.');
  }
  const blob = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const plaintext = decrypt(blob, password);
  return JSON.parse(plaintext);
}
