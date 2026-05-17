# discord-wallet

A **self-hosted**, **self-custodial**, **no-KYC** Discord bot that lets you control your own crypto wallets through slash commands in a private Discord server.

-  You hold the keys. The bot runs on your machine. No third party, no signups.
-  Pluggable multi-chain support. Ships with **Ethereum, Base, Arbitrum, Polygon, Solana**. Drop in another file to add more.
-  Browser-based **setup wizard** generates a fresh BIP-39 wallet (or imports yours) and writes an encrypted config.
-  Every `/send` requires a button confirmation that expires in 30 seconds.
-  Triple lock: bot only responds to your user ID, in your server, optionally in one channel.

---

## What you need

- **Node.js 18.17+** ([nodejs.org](https://nodejs.org))
- A **private Discord server** you own
- A **Discord bot** you create at [discord.com/developers/applications](https://discord.com/developers/applications)

### Creating the Discord bot (5 minutes)

1. Go to https://discord.com/developers/applications → **New Application**.
2. Open the **Bot** tab → **Reset Token** → copy the token (you'll paste it into the wizard).
3. **OAuth2 → URL Generator**: tick scopes `bot` and `applications.commands`. Under bot permissions tick `Send Messages` and `Embed Links`. Open the generated URL and invite the bot to your server.
4. In Discord, enable **Developer Mode** (`Settings → Advanced`). Right-click your user, server, and target channel and **Copy ID** for each.

---

## Install

The project ships with a `.npmrc` that hard-disables npm install scripts. **This is intentional** — all major npm supply-chain attacks in 2026 (axios RAT, node-ipc credential stealer, Mini Shai-Hulud / TeamPCP waves hitting SAP/TanStack/Mistral packages) deliver their payload via `preinstall`/`install`/`postinstall` hooks. Disabling them stops the attack at the front door.

```bash
cd discord-wallet
npm install        # .npmrc forces --ignore-scripts automatically
npm run audit-deps # verify nothing in node_modules matches a known compromise
```

`npm run audit-deps` does three things:
1. Scans every installed package against a list of known-compromised versions from the recent attacks.
2. Lists every `preinstall`/`install`/`postinstall` hook in your tree and flags anything that isn't a recognized native-binding builder (like `node-gyp-build`).
3. Runs `npm audit` for regular CVEs.

If you ever see a `REVIEW` line under "install hooks found," inspect that package on [socket.dev](https://socket.dev) before doing anything else.

The included `.npmrc` also sets `min-release-age=7d` (npm ≥ 10.9) — you won't pull a package version that was published less than 7 days ago. Most malicious versions are caught and unpublished within hours-to-days, so this single setting kills the majority of supply-chain risk. CISA recommended it after the axios compromise.



## Run the setup wizard

```bash
npm run setup
```

A browser opens at `http://localhost:7866` with a 6-step wizard:

1. **Discord** — paste bot token, your user ID, server ID, (optional) channel ID
2. **Password** — encrypts the config at rest with AES-256-GCM / PBKDF2 (600k iter)
3. **Wallet** — generate a fresh 24-word BIP-39 mnemonic, or import an existing one
4. **Backup** — write the seed phrase down, tick the acknowledgement
5. **Chains** — toggle which chains to enable and set RPC URLs
6. **Review & save** — config gets written to `config/wallet.enc.json`

When done, close the browser and stop the setup server with Ctrl+C.

## Run the bot

```bash
npm start
```

Type the password from step 2. The bot will:

- Decrypt the config
- Log in to Discord
- Register slash commands in your server
- Wait for `/balance`, `/address`, `/send`, `/help`

### Commands

| Command | What it does |
|---|---|
| `/balance [chain]` | Native balance for one chain, or all if omitted |
| `/address <chain>` | Your receive address + QR code |
| `/send <chain> <to> <amount>` | Build a tx, show confirm/cancel buttons |
| `/help` | List available chains |

Every response is **ephemeral** — only you can see it.

---

## Security model (read this)

**The bot is a hot wallet.** Anything sitting in addresses it controls is reachable by:
- whoever has your encryption password + the `config/wallet.enc.json` file
- whoever holds the 24-word seed phrase
- whoever compromises the machine the bot runs on

Mitigations baked in:
- Config is encrypted at rest. Without the password the file is useless.
- All slash commands are gated by **user ID + guild ID + (optional) channel ID**. A leaked bot token alone can't drain you.
- Every send requires a button confirmation. No "instant" transfers.
- Ephemeral replies — random server members can't see your balances.

What this project does **not** do:
- No KYC, no centralized exchange integration, no custody by anyone else.
- No automatic price conversion, no ERC-20 tokens (yet — easy to add), no NFTs.
- No browser extensions. No transmission of any data anywhere except RPC and Discord.

For real money, do at least these things:
1. Use **dedicated low-value addresses** on this bot. Sweep profits to cold storage.
2. Use **paid RPC** (Alchemy, Helius, QuickNode free tiers are fine for personal use). Public RPCs rate-limit and can lie about state.
3. Enable **2FA** on the Discord account that owns the bot.
4. **Don't commit `config/wallet.enc.json`** to git, even though it's encrypted. (The included `.gitignore` already excludes it.)
5. Consider running the bot in a **dedicated VM** or container.

---

## Adding a chain

Each chain is one file in `platforms/`. Implement the interface from `platforms/base.js`:

```js
// platforms/litecoin.js (example sketch)
import { makePlatform } from './base.js';

export function createLitecoinPlatform({ rpcUrl, privateKey, explorerUrl }) {
  return makePlatform({
    id: 'ltc',
    name: 'Litecoin',
    symbol: 'LTC',
    async getAddress() { /* ... */ },
    async getBalance() { /* ... */ },
    async send(to, amount) { /* ... */ },
    validateAddress(addr) { /* ... */ },
  });
}
```

Then wire it up in `buildPlatforms()` inside `bot.js` (one `else if` branch) and add it to the chains list in `public/setup.js`.

---

## File layout

```
discord-wallet/
├── package.json            # pinned exact versions
├── package-lock.json       # locked transitive tree
├── .npmrc                  # ignore-scripts, min-release-age=7d
├── bot.js                  # main bot
├── setup-server.js         # local express server for the wizard
├── scripts/
│   └── audit-deps.js       # supply-chain audit (npm run audit-deps)
├── public/                 # wizard GUI
│   ├── index.html
│   ├── setup.js
│   └── style.css
├── lib/
│   ├── crypto.js           # AES-GCM + PBKDF2
│   └── wallet.js           # config load/save
├── platforms/              # one file per chain
│   ├── base.js
│   ├── ethereum.js
│   └── solana.js
└── config/
    └── wallet.enc.json     # encrypted, generated by the wizard
```

## License

MIT. Provided as-is, no warranty, you're responsible for your funds.
