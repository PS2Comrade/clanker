import { Client, GatewayIntentBits, Collection, REST, Routes } from 'discord.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

import { initDatabase } from './database/db.js';
import { 
  trSlashCommand, 
  trAutoCommand, 
  trStatusCommand, 
  handleAutoTranslation,
  handlePrefixTr 
} from './commands/translation.js';
import { 
  warnCommand, 
  muteCommand, 
  unmuteCommand, 
  kickCommand, 
  banCommand, 
  unbanCommand, 
  warnsCommand, 
  clearwarnsCommand, 
  modstatsCommand,
  handlePrefixModeration 
} from './commands/moderation.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load configuration
let config;
try {
  const configPath = join(__dirname, '../config.json');
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (error) {
  console.error('Failed to load config.json:', error.message);
  process.exit(1);
}

// Override config with environment variables if present
if (process.env.DISCORD_TOKEN) {
  config.discord_token = process.env.DISCORD_TOKEN;
}
if (process.env.CLIENT_ID) {
  config.client_id = process.env.CLIENT_ID;
}

if (!config.discord_token) {
  console.error('Discord token not found in config.json or environment variables!');
  process.exit(1);
}

// Create Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ]
});

// Initialize commands collection
client.commands = new Collection();

// Register slash commands
const commands = [
  trSlashCommand,
  trAutoCommand,
  trStatusCommand,
  warnCommand,
  muteCommand,
  unmuteCommand,
  kickCommand,
  banCommand,
  unbanCommand,
  warnsCommand,
  clearwarnsCommand,
  modstatsCommand
];

commands.forEach(cmd => {
  client.commands.set(cmd.data.name, cmd);
});

// Register commands with Discord
async function registerCommands() {
  try {
    console.log('Started refreshing application (/) commands.');
    
    const rest = new REST({ version: '10' }).setToken(config.discord_token);
    const commandData = commands.map(cmd => cmd.data.toJSON());
    
    if (config.client_id) {
      await rest.put(
        Routes.applicationCommands(config.client_id),
        { body: commandData }
      );
      console.log(`Successfully registered ${commandData.length} application commands.`);
    } else {
      console.warn('CLIENT_ID not set - slash commands will not be registered!');
    }
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

// Bot ready event
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📊 Serving ${client.guilds.cache.size} guilds`);
  
  // Initialize database
  initDatabase();
  
  // Register commands
  await registerCommands();
  
  console.log('🤖 Bot is ready!');
});

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  
  try {
    await command.execute(interaction, config);
  } catch (error) {
    console.error('Command execution error:', error);
    const reply = { content: 'An error occurred while executing this command.', ephemeral: true };
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// Handle messages (for prefix commands and auto-translation)
client.on('messageCreate', async message => {
  // Ignore bot messages
  if (message.author.bot) return;
  
  // Handle prefix commands
  if (message.content.startsWith('!')) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // Translation commands
    if (command === 'tr') {
      await handlePrefixTr(message, args, config);
      return;
    }
    
    if (command === 'tr_status') {
      // Simple status for prefix command
      await message.reply('Use `/tr_status` slash command for full status information.');
      return;
    }
    
    // Auto-translate management
    if (command === 'tr_auto') {
      if (!message.member.permissions.has('ManageGuild')) {
        await message.reply('You need Manage Guild permission.');
        return;
      }
      
      const subcommand = args[0];
      if (subcommand === 'add' || subcommand === 'remove' || subcommand === 'list') {
        await message.reply('Use `/tr_auto` slash command for channel management.');
      } else {
        await message.reply('Usage: `!tr_auto add|remove|list`');
      }
      return;
    }
    
    // Moderation commands
    const modCommands = ['warn', 'mute', 'unmute', 'kick', 'ban', 'unban', 'warns', 'clearwarns', 'modstats'];
    if (modCommands.includes(command)) {
      await handlePrefixModeration(message, command, args);
      return;
    }
  }
  
  // Handle auto-translation
  if (message.guild) {
    await handleAutoTranslation(message, config);
  }
});

// Error handling
client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(config.discord_token).catch(error => {
  console.error('Failed to login:', error);
  process.exit(1);
});

console.log('🚀 Starting Clanker bot...');
