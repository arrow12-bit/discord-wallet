// bot.js
// Main Discord bot entry point.
// - Prompts for the password to decrypt config
// - Restricts all commands to your user ID + guild + channel
// - Implements /balance, /address, /send, /help

import readline from 'node:readline';
import { Writable } from 'node:stream';
import QRCode from 'qrcode';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  EmbedBuilder,
} from 'discord.js';

import { loadConfig } from './lib/wallet.js';
import { createEthereumPlatform } from './platforms/ethereum.js';
import { createSolanaPlatform } from './platforms/solana.js';

// ---------- password prompt (masks input) ----------
function promptPassword(question) {
  return new Promise((resolve) => {
    const mutableStdout = new Writable({
      write(chunk, encoding, cb) {
        if (!this.muted) process.stdout.write(chunk, encoding);
        cb();
      },
    });
    mutableStdout.muted = false;
    const rl = readline.createInterface({
      input: process.stdin,
      output: mutableStdout,
      terminal: true,
    });
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    mutableStdout.muted = true;
  });
}

// ---------- platform registry ----------
// Keyed by `label` so multiple EVM chains (eth, base, arb, polygon) coexist.
function buildPlatforms(config) {
  const platforms = new Map();
  for (const p of config.platforms || []) {
    if (!p.enabled) continue;
    const label = p.label || p.id;
    let impl;
    if (p.id === 'eth') {
      impl = createEthereumPlatform({
        rpcUrl: p.rpcUrl,
        privateKey: config.wallet.evmPrivateKey,
        explorerUrl: p.explorerUrl || 'https://etherscan.io',
      });
    } else if (p.id === 'sol') {
      impl = createSolanaPlatform({
        rpcUrl: p.rpcUrl,
        secretKey: config.wallet.solanaSecretKey,
        explorerUrl: p.explorerUrl || 'https://solscan.io',
      });
    } else {
      console.warn(`  unknown platform type: ${p.id}`);
      continue;
    }
    // Override display name/symbol from config so e.g. Base shows correctly.
    impl.name = p.name || impl.name;
    impl.symbol = p.symbol || impl.symbol;
    impl.label = label;
    platforms.set(label, impl);
  }
  return platforms;
}

// ---------- slash command schema ----------
function buildCommandDefinitions(platforms) {
  const choices = [...platforms.entries()].map(([label, p]) => ({
    name: `${label.toUpperCase()} · ${p.name}`,
    value: label,
  }));

  return [
    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Show balance for a chain (or all chains)')
      .addStringOption((o) =>
        o.setName('chain').setDescription('Which chain').setRequired(false).addChoices(...choices)
      ),
    new SlashCommandBuilder()
      .setName('address')
      .setDescription('Show your receive address (with QR)')
      .addStringOption((o) =>
        o.setName('chain').setDescription('Which chain').setRequired(true).addChoices(...choices)
      ),
    new SlashCommandBuilder()
      .setName('send')
      .setDescription('Send crypto (requires confirmation)')
      .addStringOption((o) =>
        o.setName('chain').setDescription('Which chain').setRequired(true).addChoices(...choices)
      )
      .addStringOption((o) => o.setName('to').setDescription('Destination address').setRequired(true))
      .addStringOption((o) => o.setName('amount').setDescription('Amount (native token)').setRequired(true)),
    new SlashCommandBuilder().setName('help').setDescription('Show available commands'),
  ].map((c) => c.toJSON());
}

// ---------- main ----------
async function main() {
  console.log('\n  discord-wallet — self-hosted, no KYC\n');

  const password = process.env.WALLET_PASSWORD || (await promptPassword('  unlock password: '));

  let config;
  try {
    config = loadConfig(password);
  } catch (err) {
    console.error('  Failed to decrypt config:', err.message);
    process.exit(1);
  }
  console.log('  config decrypted ✓');

  const platforms = buildPlatforms(config);
  if (platforms.size === 0) {
    console.error('  no platforms enabled in config — run `npm run setup` again');
    process.exit(1);
  }
  console.log(`  loaded platforms: ${[...platforms.keys()].join(', ')}`);

  const { discord } = config;
  const ALLOWED_USER = discord.userId;
  const ALLOWED_GUILD = discord.guildId;
  const ALLOWED_CHANNEL = discord.channelId || null;

  const rest = new REST({ version: '10' }).setToken(discord.botToken);
  const commands = buildCommandDefinitions(platforms);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once('ready', async () => {
    console.log(`  logged in as ${client.user.tag}`);
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, ALLOWED_GUILD), { body: commands });
      console.log('  slash commands registered');
    } catch (err) {
      console.error('  failed to register commands:', err.message);
    }
  });

  const pending = new Map();

  client.on('interactionCreate', async (interaction) => {
    if (interaction.user.id !== ALLOWED_USER) {
      return interaction.reply({ content: 'Not authorized.', ephemeral: true });
    }
    if (interaction.guildId !== ALLOWED_GUILD) {
      return interaction.reply({ content: 'Wrong server.', ephemeral: true });
    }
    if (ALLOWED_CHANNEL && interaction.channelId !== ALLOWED_CHANNEL) {
      return interaction.reply({ content: 'Wrong channel.', ephemeral: true });
    }

    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, platforms, pending);
      } else if (interaction.isButton()) {
        await handleButton(interaction, platforms, pending);
      }
    } catch (err) {
      console.error('interaction error:', err);
      const msg = `Error: ${err.message || err}`;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: msg, ephemeral: true });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    }
  });

  await client.login(discord.botToken);
}

async function handleCommand(interaction, platforms, pending) {
  const cmd = interaction.commandName;

  if (cmd === 'help') {
    const chainList = [...platforms.entries()]
      .map(([label, p]) => `  • \`${label}\` — ${p.name} (${p.symbol})`)
      .join('\n');
    const lines = [
      '**discord-wallet**',
      '`/balance [chain]` — show balance (omit chain for all)',
      '`/address <chain>` — receive address + QR',
      '`/send <chain> <to> <amount>` — send, asks for confirmation',
      '',
      'Active chains:',
      chainList,
    ];
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }

  if (cmd === 'balance') {
    await interaction.deferReply({ ephemeral: true });
    const chain = interaction.options.getString('chain');
    const list = chain ? [chain] : [...platforms.keys()];
    const rows = [];
    for (const id of list) {
      const p = platforms.get(id);
      if (!p) continue;
      try {
        const bal = await p.getBalance();
        rows.push(`**${p.name}** — \`${bal.native}\` ${p.symbol}`);
      } catch (e) {
        rows.push(`**${p.name}** — error: ${e.message}`);
      }
    }
    return interaction.editReply({ content: rows.join('\n') || 'no chains' });
  }

  if (cmd === 'address') {
    await interaction.deferReply({ ephemeral: true });
    const id = interaction.options.getString('chain');
    const p = platforms.get(id);
    if (!p) return interaction.editReply('unknown chain');
    const addr = await p.getAddress();
    const png = await QRCode.toBuffer(addr, { width: 320, margin: 1 });
    const file = new AttachmentBuilder(png, { name: 'address.png' });
    const embed = new EmbedBuilder()
      .setTitle(`${p.name} — receive address`)
      .setDescription('```' + addr + '```')
      .setImage('attachment://address.png')
      .setColor(0xffb000);
    return interaction.editReply({ embeds: [embed], files: [file] });
  }

  if (cmd === 'send') {
    const id = interaction.options.getString('chain');
    const to = interaction.options.getString('to');
    const amount = interaction.options.getString('amount');
    const p = platforms.get(id);
    if (!p) return interaction.reply({ content: 'unknown chain', ephemeral: true });
    if (!p.validateAddress(to)) {
      return interaction.reply({ content: `Invalid ${p.name} address`, ephemeral: true });
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      return interaction.reply({ content: 'Invalid amount', ephemeral: true });
    }

    const confirmId = `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pending.set(confirmId, { chain: id, to, amount, expires: Date.now() + 30_000 });
    setTimeout(() => pending.delete(confirmId), 30_000);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm:${confirmId}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`cancel:${confirmId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    const embed = new EmbedBuilder()
      .setTitle('Confirm transaction')
      .setColor(0xffb000)
      .setDescription(
        [
          `**Chain:** ${p.name}`,
          `**To:** \`${to}\``,
          `**Amount:** ${amount} ${p.symbol}`,
          '',
          '_Expires in 30s._',
        ].join('\n')
      );
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }
}

async function handleButton(interaction, platforms, pending) {
  const [action, confirmId] = interaction.customId.split(':');
  const job = pending.get(confirmId);
  if (!job) {
    return interaction.update({ content: 'Expired or unknown.', embeds: [], components: [] });
  }
  pending.delete(confirmId);

  if (action === 'cancel') {
    return interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
  }

  if (action === 'confirm') {
    await interaction.update({ content: 'Broadcasting…', embeds: [], components: [] });
    const p = platforms.get(job.chain);
    try {
      const { hash, explorerUrl } = await p.send(job.to, job.amount);
      await interaction.editReply({
        content: `Sent ✓\n\`${hash}\`\n${explorerUrl}`,
      });
    } catch (e) {
      await interaction.editReply({ content: `Send failed: ${e.message}` });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
