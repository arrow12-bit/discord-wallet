// public/setup.js
// Setup wizard logic. All operations are local; calls go to 127.0.0.1.

const state = {
  step: 1,
  discord: { botToken: '', userId: '', guildId: '', channelId: '' },
  password: '',
  wallet: null, // { mnemonic, evm: {address, privateKey}, sol: {address, secretKey} }
  chains: [
    { id: 'eth', name: 'Ethereum (Mainnet)', symbol: 'ETH', enabled: false,
      rpcUrl: 'https://eth.llamarpc.com',
      explorerUrl: 'https://etherscan.io', chipClass: 'eth' },
    { id: 'base', name: 'Base', symbol: 'ETH', enabled: false,
      rpcUrl: 'https://mainnet.base.org',
      explorerUrl: 'https://basescan.org', chipClass: 'eth', evmCompat: true },
    { id: 'arb', name: 'Arbitrum One', symbol: 'ETH', enabled: false,
      rpcUrl: 'https://arb1.arbitrum.io/rpc',
      explorerUrl: 'https://arbiscan.io', chipClass: 'eth', evmCompat: true },
    { id: 'polygon', name: 'Polygon', symbol: 'MATIC', enabled: false,
      rpcUrl: 'https://polygon-rpc.com',
      explorerUrl: 'https://polygonscan.com', chipClass: 'eth', evmCompat: true },
    { id: 'sol', name: 'Solana', symbol: 'SOL', enabled: false,
      rpcUrl: 'https://api.mainnet-beta.solana.com',
      explorerUrl: 'https://solscan.io', chipClass: 'sol' },
  ],
};

// ─── step navigation ───
function goTo(step) {
  state.step = step;
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('hidden', Number(p.dataset.step) !== step);
  });
  document.querySelectorAll('.rail-step').forEach((r) => {
    const s = Number(r.dataset.step);
    r.classList.toggle('active', s === step);
    r.classList.toggle('done', s < step);
  });
  if (step === 6) renderReview();
  if (step === 5) renderChains();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = Number(btn.dataset.go);
    if (target > state.step && !validateStep(state.step)) return;
    if (state.step === 1) saveDiscord();
    if (state.step === 2) saveAccount();
    goTo(target);
  });
});

function validateStep(step) {
  if (step === 1) {
    const t = (id) => document.getElementById(id).value.trim();
    if (!t('botToken')) return alertField('Bot token required'), false;
    if (!/^\d{17,20}$/.test(t('userId'))) return alertField('User ID looks invalid (17-20 digits)'), false;
    if (!/^\d{17,20}$/.test(t('guildId'))) return alertField('Server ID looks invalid'), false;
    if (t('channelId') && !/^\d{17,20}$/.test(t('channelId'))) return alertField('Channel ID looks invalid'), false;
  }
  if (step === 2) {
    const p1 = document.getElementById('pw1').value;
    const p2 = document.getElementById('pw2').value;
    if (p1.length < 8) return alertField('Password must be at least 8 chars'), false;
    if (p1 !== p2) return alertField('Passwords don\'t match'), false;
  }
  if (step === 3) {
    if (!state.wallet) return alertField('Generate or import a wallet first'), false;
  }
  if (step === 4) {
    if (!document.getElementById('ackBackup').checked) return alertField('Acknowledge backup first'), false;
  }
  if (step === 5) {
    if (!state.chains.some((c) => c.enabled)) return alertField('Enable at least one chain'), false;
    for (const c of state.chains) {
      if (c.enabled && !c.rpcUrl) return alertField(`Set an RPC URL for ${c.name}`), false;
    }
  }
  return true;
}

function alertField(msg) {
  // simple inline notice; could be prettier
  const el = document.createElement('div');
  el.textContent = `! ${msg}`;
  el.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #ff5a4e; color: #0a0a0b; padding: 10px 18px;
    font-size: 12px; letter-spacing: 0.08em; font-weight: 700;
    z-index: 200; box-shadow: 0 0 20px -4px #ff5a4e;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

// ─── step 1: discord ───
function saveDiscord() {
  state.discord = {
    botToken: document.getElementById('botToken').value.trim(),
    userId: document.getElementById('userId').value.trim(),
    guildId: document.getElementById('guildId').value.trim(),
    channelId: document.getElementById('channelId').value.trim(),
  };
}

// ─── step 2: password ───
function saveAccount() {
  state.password = document.getElementById('pw1').value;
}

function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 5);
}
document.getElementById('pw1').addEventListener('input', (e) => {
  const v = e.target.value;
  const s = strength(v);
  const labels = ['enter a password', 'very weak', 'weak', 'ok', 'good', 'strong', 'excellent'];
  const colors = ['#22222a', '#ff5a4e', '#ff8a4e', '#ffb000', '#e8d24a', '#a6cb6f', '#6fcb6f'];
  const bar = document.getElementById('strength-bar');
  bar.style.width = `${(s / 5) * 100}%`;
  bar.style.background = colors[v.length ? s + 1 : 0];
  document.getElementById('strength-label').textContent = labels[v.length ? s + 1 : 0];
});

// ─── step 3: wallet ───
document.querySelectorAll('.choice-card').forEach((card) => {
  card.addEventListener('click', async () => {
    document.querySelectorAll('.choice-card').forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    const action = card.dataset.action;

    if (action === 'generate') {
      document.getElementById('import-zone').classList.add('hidden');
      document.getElementById('genStatus').textContent = 'generating...';
      try {
        const res = await fetch('/api/generate-wallet', { method: 'POST' });
        const data = await res.json();
        state.wallet = data;
        document.getElementById('genStatus').textContent = '✓ wallet ready';
        renderBackup();
        setTimeout(() => goTo(4), 600);
      } catch (e) {
        document.getElementById('genStatus').textContent = 'error: ' + e.message;
      }
    } else if (action === 'import') {
      document.getElementById('import-zone').classList.remove('hidden');
    }
  });
});

document.getElementById('doImport').addEventListener('click', async () => {
  const mnemonic = document.getElementById('mnemonicInput').value.trim();
  if (!mnemonic) return alertField('paste a mnemonic first');
  const res = await fetch('/api/import-wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mnemonic }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return alertField(err.error || 'import failed');
  }
  state.wallet = await res.json();
  renderBackup();
  goTo(4);
});

// ─── step 4: backup ───
function renderBackup() {
  const words = state.wallet.mnemonic.split(/\s+/);
  const grid = document.getElementById('seedGrid');
  grid.innerHTML = words.map((w, i) => `
    <div class="seedword">
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
      <span class="w">${w}</span>
    </div>
  `).join('');
  document.getElementById('evmAddr').textContent = state.wallet.evm.address;
  document.getElementById('solAddr').textContent = state.wallet.sol.address;
}

document.getElementById('copySeed').addEventListener('click', async () => {
  await navigator.clipboard.writeText(state.wallet.mnemonic);
  const btn = document.getElementById('copySeed');
  const orig = btn.textContent;
  btn.textContent = 'copied ✓';
  setTimeout(() => (btn.textContent = orig), 1400);
});

document.getElementById('ackBackup').addEventListener('change', (e) => {
  document.getElementById('toChains').disabled = !e.target.checked;
});
document.getElementById('toChains').addEventListener('click', () => goTo(5));

// ─── step 5: chains ───
function renderChains() {
  const list = document.getElementById('chainList');
  list.innerHTML = state.chains.map((c, i) => {
    const addr = (c.id === 'sol') ? state.wallet?.sol.address : state.wallet?.evm.address;
    return `
      <div class="chain ${c.enabled ? 'enabled' : ''}" data-i="${i}">
        <div class="chain-head">
          <div class="chain-name">
            <span class="chip ${c.chipClass}">${c.symbol}</span>
            ${c.name}
          </div>
          <label class="toggle">
            <input type="checkbox" data-toggle="${i}" ${c.enabled ? 'checked' : ''}>
            <span class="track"></span>
          </label>
        </div>
        <div class="chain-body">
          <input type="text" data-rpc="${i}" value="${c.rpcUrl}" placeholder="RPC URL">
          <input type="text" data-explorer="${i}" value="${c.explorerUrl}" placeholder="Explorer URL">
        </div>
        <div style="margin-top:10px; font-size:11px; color:var(--ink-3); word-break:break-all">
          address: <span style="color:var(--ink-2)">${addr || '—'}</span>
        </div>
      </div>
    `;
  }).join('');
  list.querySelectorAll('[data-toggle]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const i = Number(e.target.dataset.toggle);
      state.chains[i].enabled = e.target.checked;
      e.target.closest('.chain').classList.toggle('enabled', e.target.checked);
    });
  });
  list.querySelectorAll('[data-rpc]').forEach((el) => {
    el.addEventListener('input', (e) => {
      state.chains[Number(e.target.dataset.rpc)].rpcUrl = e.target.value.trim();
    });
  });
  list.querySelectorAll('[data-explorer]').forEach((el) => {
    el.addEventListener('input', (e) => {
      state.chains[Number(e.target.dataset.explorer)].explorerUrl = e.target.value.trim();
    });
  });
}

// ─── step 6: review + save ───
function buildConfig() {
  // Map our chains to platform entries. All EVM chains use the same private key.
  const platforms = state.chains
    .filter((c) => c.enabled)
    .map((c) => ({
      id: c.id === 'sol' ? 'sol' : 'eth', // bot platform-id (currently eth or sol)
      label: c.id, // friendly chain id
      name: c.name,
      symbol: c.symbol,
      enabled: true,
      rpcUrl: c.rpcUrl,
      explorerUrl: c.explorerUrl,
    }));

  return {
    discord: state.discord,
    wallet: {
      mnemonic: state.wallet.mnemonic,
      evmPrivateKey: state.wallet.evm.privateKey,
      evmAddress: state.wallet.evm.address,
      solanaSecretKey: state.wallet.sol.secretKey,
      solanaAddress: state.wallet.sol.address,
    },
    platforms,
    createdAt: new Date().toISOString(),
  };
}

function renderReview() {
  const cfg = buildConfig();
  const redacted = JSON.parse(JSON.stringify(cfg));
  redacted.discord.botToken = mask(cfg.discord.botToken);
  redacted.wallet.mnemonic = '[ 24 words — encrypted ]';
  redacted.wallet.evmPrivateKey = mask(cfg.wallet.evmPrivateKey);
  redacted.wallet.solanaSecretKey = '[ encrypted ]';
  document.getElementById('reviewBox').textContent = JSON.stringify(redacted, null, 2);
}

function mask(s) {
  if (!s) return '';
  if (s.length < 12) return '***';
  return s.slice(0, 6) + '…' + s.slice(-4);
}

document.getElementById('saveBtn').addEventListener('click', async () => {
  if (!validateStep(5)) return;
  const cfg = buildConfig();
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = 'encrypting...';
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: state.password, config: cfg }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'save failed');
    }
    document.getElementById('doneBox').classList.remove('hidden');
    btn.textContent = 'saved ✓';
    document.getElementById('status-text').textContent = 'READY';
  } catch (e) {
    alertField(e.message);
    btn.disabled = false;
    btn.textContent = 'encrypt & save ↓';
  }
});

// init
goTo(1);
