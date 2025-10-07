import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { translate } from '../utils/translationProviders.js';
import { guildConfig } from '../database/db.js';

// Regex patterns
const MSG_LINK_REGEX = /https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(?:@me|\d+)\/(\d+)\/(\d+)/i;
const CUSTOM_EMOJI_REGEX = /<a?:\w+:\d+>/g;
const NUMERIC_LIKE_REGEX = /^\s*[\d\s\-+()[\],./:]+\s*$/;

function stripCustomEmojis(text) {
  return text.replace(CUSTOM_EMOJI_REGEX, '').trim();
}

function isNumericLike(text) {
  return NUMERIC_LIKE_REGEX.test(text);
}

function hasNonAsciiLetters(text) {
  return /[^\x00-\x7F]/.test(text) && /\p{L}/u.test(text);
}

// Translate command (slash)
export const trSlashCommand = {
  data: new SlashCommandBuilder()
    .setName('tr')
    .setDescription('Translate a message or text to English')
    .addStringOption(option =>
      option.setName('text')
        .setDescription('Text to translate or message link')
        .setRequired(false)
    ),
  
  async execute(interaction, config) {
    await interaction.deferReply();
    
    try {
      let textToTranslate = interaction.options.getString('text');
      let referencedMessage = null;
      
      // Check if replying to a message
      if (!textToTranslate && interaction.channel) {
        const messages = await interaction.channel.messages.fetch({ limit: 10 });
        const replied = messages.find(m => 
          m.reference?.messageId && 
          m.author.id === interaction.user.id
        );
        if (replied) {
          const ref = await interaction.channel.messages.fetch(replied.reference.messageId);
          referencedMessage = ref;
          textToTranslate = ref.content;
        }
      }
      
      // Check for message link
      if (textToTranslate) {
        const linkMatch = textToTranslate.match(MSG_LINK_REGEX);
        if (linkMatch) {
          const [, channelId, messageId] = linkMatch;
          try {
            const channel = await interaction.client.channels.fetch(channelId);
            const message = await channel.messages.fetch(messageId);
            textToTranslate = message.content;
            referencedMessage = message;
          } catch (error) {
            await interaction.editReply('Could not fetch message from link.');
            return;
          }
        }
      }
      
      if (!textToTranslate) {
        await interaction.editReply('Please provide text to translate or reply to a message.');
        return;
      }
      
      // Strip custom emojis
      textToTranslate = stripCustomEmojis(textToTranslate);
      
      // Check if numeric-like
      if (config.translation.ignore_numeric_like && isNumericLike(textToTranslate)) {
        await interaction.editReply('Text appears to be numeric or special characters only.');
        return;
      }
      
      // Check if has non-ASCII letters
      if (!hasNonAsciiLetters(textToTranslate)) {
        await interaction.editReply('Text appears to be already in English or contains no translatable content.');
        return;
      }
      
      // Translate
      const result = await translate(textToTranslate, 'en', config.translation.providers);
      
      if (!result) {
        await interaction.editReply('Translation failed. Please try again later.');
        return;
      }
      
      // Check blacklist
      const guildCfg = guildConfig.get(interaction.guildId);
      if (guildCfg.blacklisted_languages.includes(result.detectedLanguage)) {
        await interaction.editReply(`Language ${result.detectedLanguage} is blacklisted in this server.`);
        return;
      }
      
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Translation')
        .setDescription(result.text)
        .setFooter({ text: `${result.detectedLanguage} → EN | via ${result.provider}` });
      
      if (referencedMessage) {
        embed.addFields({ 
          name: 'Original', 
          value: textToTranslate.substring(0, 1024) 
        });
      }
      
      await interaction.editReply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Translation error:', error);
      await interaction.editReply('An error occurred while translating.');
    }
  }
};

// Auto-translate channel management
export const trAutoCommand = {
  data: new SlashCommandBuilder()
    .setName('tr_auto')
    .setDescription('Manage auto-translation channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a channel for auto-translation')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel to add')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a channel from auto-translation')
        .addChannelOption(option =>
          option.setName('channel')
            .setDescription('Channel to remove')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List auto-translation channels')
    ),
  
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    
    if (subcommand === 'add') {
      guildConfig.addAutoTranslateChannel(interaction.guildId, channel.id);
      await interaction.reply({ 
        content: `Added ${channel} to auto-translation.`, 
        ephemeral: true 
      });
    } else if (subcommand === 'remove') {
      guildConfig.removeAutoTranslateChannel(interaction.guildId, channel.id);
      await interaction.reply({ 
        content: `Removed ${channel} from auto-translation.`, 
        ephemeral: true 
      });
    } else if (subcommand === 'list') {
      const cfg = guildConfig.get(interaction.guildId);
      const channels = cfg.auto_translate_channels;
      
      if (channels.length === 0) {
        await interaction.reply({ 
          content: 'No auto-translation channels configured.', 
          ephemeral: true 
        });
      } else {
        const channelList = channels.map(id => `<#${id}>`).join(', ');
        await interaction.reply({ 
          content: `Auto-translation enabled in: ${channelList}`, 
          ephemeral: true 
        });
      }
    }
  }
};

// Translation status
export const trStatusCommand = {
  data: new SlashCommandBuilder()
    .setName('tr_status')
    .setDescription('Show translation configuration for this server'),
  
  async execute(interaction, config) {
    const guildCfg = guildConfig.get(interaction.guildId);
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Translation Status')
      .setDescription(`**Server:** ${interaction.guild.name}`);
    
    // Auto-translate channels
    if (guildCfg.auto_translate_channels.length > 0) {
      const channels = guildCfg.auto_translate_channels.map(id => `<#${id}>`).join(', ');
      embed.addFields({ name: 'Auto-Translate Channels', value: channels });
    } else {
      embed.addFields({ name: 'Auto-Translate Channels', value: 'None configured' });
    }
    
    // Blacklisted languages
    if (guildCfg.blacklisted_languages.length > 0) {
      embed.addFields({ 
        name: 'Blacklisted Languages', 
        value: guildCfg.blacklisted_languages.join(', ') 
      });
    }
    
    // Provider
    embed.addFields({ 
      name: 'Translation Provider', 
      value: guildCfg.translation_provider || 'lingva' 
    });
    
    // Settings
    embed.addFields({
      name: 'Settings',
      value: `Ignore numeric: ${config.translation.ignore_numeric_like}\nMin words: ${config.translation.auto_min_words}`
    });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

// Handle auto-translation on messages
export async function handleAutoTranslation(message, config) {
  if (message.author.bot) return;
  if (!message.guild) return;
  
  const guildCfg = guildConfig.get(message.guild.id);
  
  // Check if channel is configured for auto-translate
  if (!guildCfg.auto_translate_channels.includes(message.channel.id)) {
    return;
  }
  
  let content = message.content;
  if (!content) return;
  
  // Strip custom emojis
  content = stripCustomEmojis(content);
  
  // Check minimum words
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < config.translation.auto_min_words) {
    return;
  }
  
  // Check if numeric-like
  if (config.translation.ignore_numeric_like && isNumericLike(content)) {
    return;
  }
  
  // Check if has non-ASCII letters
  if (!hasNonAsciiLetters(content)) {
    return;
  }
  
  try {
    const result = await translate(content, 'en', config.translation.providers);
    
    if (!result) return;
    
    // Check blacklist
    if (guildCfg.blacklisted_languages.includes(result.detectedLanguage)) {
      return;
    }
    
    // Don't reply if detected language is English
    if (result.detectedLanguage === 'EN') {
      return;
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setDescription(result.text)
      .setFooter({ text: `${result.detectedLanguage} → EN | via ${result.provider}` });
    
    await message.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Auto-translation error:', error);
  }
}

// Prefix command handler for !tr
export async function handlePrefixTr(message, args, config) {
  try {
    let textToTranslate = args.join(' ');
    let referencedMessage = null;
    
    // Check if replying to a message
    if (!textToTranslate && message.reference) {
      const ref = await message.channel.messages.fetch(message.reference.messageId);
      referencedMessage = ref;
      textToTranslate = ref.content;
    }
    
    // Check for message link
    if (textToTranslate) {
      const linkMatch = textToTranslate.match(MSG_LINK_REGEX);
      if (linkMatch) {
        const [, channelId, messageId] = linkMatch;
        try {
          const channel = await message.client.channels.fetch(channelId);
          const msg = await channel.messages.fetch(messageId);
          textToTranslate = msg.content;
          referencedMessage = msg;
        } catch (error) {
          await message.reply('Could not fetch message from link.');
          return;
        }
      }
    }
    
    if (!textToTranslate) {
      await message.reply('Please provide text to translate or reply to a message.');
      return;
    }
    
    // Strip custom emojis
    textToTranslate = stripCustomEmojis(textToTranslate);
    
    // Translate
    const result = await translate(textToTranslate, 'en', config.translation.providers);
    
    if (!result) {
      await message.reply('Translation failed. Please try again later.');
      return;
    }
    
    // Check blacklist
    const guildCfg = guildConfig.get(message.guild.id);
    if (guildCfg.blacklisted_languages.includes(result.detectedLanguage)) {
      await message.reply(`Language ${result.detectedLanguage} is blacklisted in this server.`);
      return;
    }
    
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Translation')
      .setDescription(result.text)
      .setFooter({ text: `${result.detectedLanguage} → EN | via ${result.provider}` });
    
    if (referencedMessage) {
      embed.addFields({ 
        name: 'Original', 
        value: textToTranslate.substring(0, 1024) 
      });
    }
    
    await message.reply({ embeds: [embed] });
    
  } catch (error) {
    console.error('Translation error:', error);
    await message.reply('An error occurred while translating.');
  }
}
