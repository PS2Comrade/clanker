import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { moderation, botModeration } from '../database/db.js';
import { 
  processWarning, 
  getUserStats, 
  getTrialName, 
  clearUserWarnings,
  parseDuration,
  formatDuration,
  logModerationAction
} from '../utils/moderationLogic.js';

export const warnCommand = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a user (3-trial system)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to warn')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for warning')
        .setRequired(false)
    ),
  
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    if (user.bot) {
      await interaction.reply({ content: 'Cannot warn bots. Use /botwarn instead.', ephemeral: true });
      return;
    }
    
    try {
      const result = processWarning(
        interaction.guildId, 
        user.id, 
        interaction.user.id, 
        reason
      );
      
      const embed = new EmbedBuilder()
        .setColor(result.banned ? 0xFF0000 : 0xFFAA00)
        .setTitle(result.banned ? '⚠️ User Banned' : '⚠️ User Warned')
        .setDescription(`**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}`)
        .addFields({ name: 'Case Number', value: `#${result.caseNumber}`, inline: true });
      
      if (result.banned) {
        embed.addFields(
          { name: 'Trial Stage', value: getTrialName(result.trialStage), inline: true },
          { name: 'Warnings', value: `${result.warnCount}/${result.warnCount}`, inline: true }
        );
        
        if (result.appealDate) {
          embed.addFields({
            name: 'Appeal Available',
            value: `<t:${Math.floor(result.appealDate.getTime() / 1000)}:R>`
          });
        } else {
          embed.addFields({ name: 'Appeal', value: 'Permanent ban - No appeal' });
        }
        
        embed.addFields({ name: 'Next Trial', value: getTrialName(result.nextStage) });
        
        try {
          const member = await interaction.guild.members.fetch(user.id);
          await member.ban({ reason: `${getTrialName(result.trialStage)} completed: ${reason}` });
          embed.setFooter({ text: 'User has been banned from the server.' });
        } catch (error) {
          console.error('Failed to ban user:', error);
          embed.setFooter({ text: 'Failed to ban user - insufficient permissions.' });
        }

        await logModerationAction(interaction.guild, 'ban', interaction.user, user.tag, reason, result.caseNumber);
      } else {
        const stats = getUserStats(interaction.guildId, user.id);
        embed.addFields(
          { name: 'Trial Stage', value: getTrialName(result.trialStage), inline: true },
          { name: 'Warnings', value: `${result.warnCount}/${stats.maxWarns}`, inline: true },
          { name: 'Until Ban', value: `${stats.warnsUntilBan} more`, inline: true }
        );

        await logModerationAction(interaction.guild, 'warn', interaction.user, user.tag, reason, result.caseNumber);
      }
      
      embed.addFields({ name: 'Reason', value: reason });
      
      await interaction.reply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Warn command error:', error);
      await interaction.reply({ content: 'An error occurred.', ephemeral: true });
    }
  }
};

export const muteCommand = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to mute')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('Duration (e.g., 1h, 30m, 1d)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for muting')
        .setRequired(false)
    ),
  
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    if (user.bot) {
      await interaction.reply({ content: 'Cannot mute bots.', ephemeral: true });
      return;
    }
    
    const duration = parseDuration(durationStr);
    if (!duration) {
      await interaction.reply({ 
        content: 'Invalid duration. Use format like: 1h, 30m, 1d', 
        ephemeral: true 
      });
      return;
    }
    
    if (duration > 28 * 24 * 60 * 60 * 1000) {
      await interaction.reply({ 
        content: 'Duration cannot exceed 28 days (Discord limit).', 
        ephemeral: true 
      });
      return;
    }
    
    try {
      const member = await interaction.guild.members.fetch(user.id);
      await member.timeout(duration, reason);
      
      const caseNumber = moderation.addActionWithCase(interaction.guildId, user.id, interaction.user.id, 'mute', reason, duration);
      
      const embed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('🔇 User Muted')
        .setDescription(`**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}`)
        .addFields(
          { name: 'Case Number', value: `#${caseNumber}`, inline: true },
          { name: 'Duration', value: formatDuration(duration), inline: true },
          { name: 'Reason', value: reason }
        )
        .setFooter({ text: 'User has been timed out.' });
      
      await interaction.reply({ embeds: [embed] });
      await logModerationAction(interaction.guild, 'mute', interaction.user, user.tag, reason, caseNumber, duration);
      
    } catch (error) {
      console.error('Mute command error:', error);
      await interaction.reply({ 
        content: 'Failed to mute user - insufficient permissions or user not found.', 
        ephemeral: true 
      });
    }
  }
};

export const unmuteCommand = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove timeout from a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to unmute')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    
    try {
      const member = await interaction.guild.members.fetch(user.id);
      await member.timeout(null);
      
      const caseNumber = moderation.addActionWithCase(interaction.guildId, user.id, interaction.user.id, 'unmute', null);
      
      await interaction.reply({ 
        content: `✅ ${user.tag} has been unmuted. Case #${caseNumber}`, 
        ephemeral: true 
      });

      await logModerationAction(interaction.guild, 'unmute', interaction.user, user.tag, null, caseNumber);
      
    } catch (error) {
      console.error('Unmute command error:', error);
      await interaction.reply({ 
        content: 'Failed to unmute user.', 
        ephemeral: true 
      });
    }
  }
};

export const kickCommand = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a user from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to kick')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for kicking')
        .setRequired(false)
    ),
  
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    if (user.bot) {
      await interaction.reply({ content: 'Cannot kick bots.', ephemeral: true });
      return;
    }
    
    try {
      const member = await interaction.guild.members.fetch(user.id);
      await member.kick(reason);
      
      const caseNumber = moderation.addActionWithCase(interaction.guildId, user.id, interaction.user.id, 'kick', reason);
      
      const embed = new EmbedBuilder()
        .setColor(0xFF6600)
        .setTitle('👢 User Kicked')
        .setDescription(`**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}`)
        .addFields(
          { name: 'Case Number', value: `#${caseNumber}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setFooter({ text: 'User has been kicked from the server.' });
      
      await interaction.reply({ embeds: [embed] });
      await logModerationAction(interaction.guild, 'kick', interaction.user, user.tag, reason, caseNumber);
      
    } catch (error) {
      console.error('Kick command error:', error);
      await interaction.reply({ 
        content: 'Failed to kick user - insufficient permissions or user not found.', 
        ephemeral: true 
      });
    }
  }
};

export const banCommand = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for banning')
        .setRequired(false)
    ),
  
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    if (user.bot) {
      await interaction.reply({ content: 'Cannot ban bots. Use /botban instead.', ephemeral: true });
      return;
    }
    
    try {
      await interaction.guild.members.ban(user.id, { reason });
      
      const caseNumber = moderation.addActionWithCase(interaction.guildId, user.id, interaction.user.id, 'ban', reason);
      
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🔨 User Banned')
        .setDescription(`**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}`)
        .addFields(
          { name: 'Case Number', value: `#${caseNumber}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setFooter({ text: 'User has been banned from the server.' });
      
      await interaction.reply({ embeds: [embed] });
      await logModerationAction(interaction.guild, 'ban', interaction.user, user.tag, reason, caseNumber);
      
    } catch (error) {
      console.error('Ban command error:', error);
      await interaction.reply({ 
        content: 'Failed to ban user - insufficient permissions.', 
        ephemeral: true 
      });
    }
  }
};
    } catch (error) {
      console.error('Ban command error:', error);
      await interaction.reply({ 
        content: 'Failed to ban user - insufficient permissions.', 
        ephemeral: true 
      });
    }
  }
};

// Unban command
export const unbanCommand = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(option =>
      option.setName('user_id')
        .setDescription('User ID to unban')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    const userId = interaction.options.getString('user_id');
    
    try {
      await interaction.guild.members.unban(userId);
      
      const caseNumber = moderation.addActionWithCase(interaction.guildId, userId, interaction.user.id, 'unban', null);
      
      await interaction.reply({ 
        content: `✅ User <@${userId}> has been unbanned. Case #${caseNumber}`, 
        ephemeral: true 
      });

      await logModerationAction(interaction.guild, 'unban', interaction.user, `<@${userId}>`, null, caseNumber);
      
    } catch (error) {
      console.error('Unban command error:', error);
      await interaction.reply({ 
        content: 'Failed to unban user - user may not be banned or invalid ID.', 
        ephemeral: true 
      });
    }
  }
};

export const hackbanCommand = {
  data: new SlashCommandBuilder()
    .setName('hackban')
    .setDescription('Ban a user by ID (even if not in server)')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(option =>
      option.setName('user_id')
        .setDescription('User ID to ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for banning')
        .setRequired(false)
    ),
  
  async execute(interaction) {
    const userId = interaction.options.getString('user_id');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    try {
      await interaction.guild.members.ban(userId, { reason: `Hackban: ${reason}` });
      
      const caseNumber = moderation.addActionWithCase(interaction.guildId, userId, interaction.user.id, 'hackban', reason);
      
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🔨 User Hackbanned')
        .setDescription(`**User ID:** ${userId}\n**Moderator:** ${interaction.user.tag}`)
        .addFields(
          { name: 'Case Number', value: `#${caseNumber}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setFooter({ text: 'User has been banned (hackban).' });
      
      await interaction.reply({ embeds: [embed] });
      await logModerationAction(interaction.guild, 'hackban', interaction.user, userId, reason, caseNumber);
      
    } catch (error) {
      console.error('Hackban command error:', error);
      await interaction.reply({ 
        content: 'Failed to hackban user - invalid ID or insufficient permissions.', 
        ephemeral: true 
      });
    }
  }
};

export const tempbanCommand = {
  data: new SlashCommandBuilder()
    .setName('tempban')
    .setDescription('Temporarily ban a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('duration')
        .setDescription('Duration (e.g., 1h, 1d, 7d)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for banning')
        .setRequired(false)
    ),
  
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    if (user.bot) {
      await interaction.reply({ content: 'Cannot tempban bots.', ephemeral: true });
      return;
    }
    
    const duration = parseDuration(durationStr);
    if (!duration) {
      await interaction.reply({ 
        content: 'Invalid duration. Use format like: 1h, 1d, 7d', 
        ephemeral: true 
      });
      return;
    }
    
    try {
      await interaction.guild.members.ban(user.id, { reason: `Tempban (${durationStr}): ${reason}` });
      
      const caseNumber = moderation.addActionWithCase(interaction.guildId, user.id, interaction.user.id, 'tempban', reason, duration);
      
      const unbanTime = Date.now() + duration;
      
      const embed = new EmbedBuilder()
        .setColor(0xFF6600)
        .setTitle('⏱️ User Temporarily Banned')
        .setDescription(`**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}`)
        .addFields(
          { name: 'Case Number', value: `#${caseNumber}`, inline: true },
          { name: 'Duration', value: formatDuration(duration), inline: true },
          { name: 'Unbanned At', value: `<t:${Math.floor(unbanTime / 1000)}:R>`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setFooter({ text: 'Note: Manual unban required after duration expires.' });
      
      await interaction.reply({ embeds: [embed] });
      await logModerationAction(interaction.guild, 'tempban', interaction.user, user.tag, reason, caseNumber, duration);
      
    } catch (error) {
      console.error('Tempban command error:', error);
      await interaction.reply({ 
        content: 'Failed to tempban user - insufficient permissions.', 
        ephemeral: true 
      });
    }
  }
};

export const botwarnCommand = {
  data: new SlashCommandBuilder()
    .setName('botwarn')
    .setDescription('Warn a bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(option =>
      option.setName('bot')
        .setDescription('Bot to warn')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for warning')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    const bot = interaction.options.getUser('bot');
    const reason = interaction.options.getString('reason');
    
    if (!bot.bot) {
      await interaction.reply({ content: 'Target must be a bot.', ephemeral: true });
      return;
    }
    
    try {
      const caseNumber = botModeration.addAction(interaction.guildId, bot.id, interaction.user.id, 'warn', reason);
      
      const embed = new EmbedBuilder()
        .setColor(0xFFAA00)
        .setTitle('🤖 Bot Warned')
        .setDescription(`**Bot:** ${bot.tag}\n**Moderator:** ${interaction.user.tag}`)
        .addFields(
          { name: 'Case Number', value: `#${caseNumber}`, inline: true },
          { name: 'Reason', value: reason }
        );
      
      await interaction.reply({ embeds: [embed] });
      await logModerationAction(interaction.guild, 'bot_warn', interaction.user, bot.tag, reason, caseNumber);
      
    } catch (error) {
      console.error('Bot warn error:', error);
      await interaction.reply({ content: 'An error occurred.', ephemeral: true });
    }
  }
};

export const botbanCommand = {
  data: new SlashCommandBuilder()
    .setName('botban')
    .setDescription('Ban a bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(option =>
      option.setName('bot')
        .setDescription('Bot to ban')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for banning')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    const bot = interaction.options.getUser('bot');
    const reason = interaction.options.getString('reason');
    
    if (!bot.bot) {
      await interaction.reply({ content: 'Target must be a bot.', ephemeral: true });
      return;
    }
    
    try {
      await interaction.guild.members.ban(bot.id, { reason: `Bot ban: ${reason}` });
      
      const caseNumber = botModeration.addAction(interaction.guildId, bot.id, interaction.user.id, 'ban', reason);
      
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('🤖 Bot Banned')
        .setDescription(`**Bot:** ${bot.tag}\n**Moderator:** ${interaction.user.tag}`)
        .addFields(
          { name: 'Case Number', value: `#${caseNumber}`, inline: true },
          { name: 'Reason', value: reason }
        )
        .setFooter({ text: 'Bot has been banned from the server.' });
      
      await interaction.reply({ embeds: [embed] });
      await logModerationAction(interaction.guild, 'bot_ban', interaction.user, bot.tag, reason, caseNumber);
      
    } catch (error) {
      console.error('Bot ban error:', error);
      await interaction.reply({ 
        content: 'Failed to ban bot - insufficient permissions.', 
        ephemeral: true 
      });
    }
  }
};

export const setModLogCommand = {
  data: new SlashCommandBuilder()
    .setName('setmodlog')
    .setDescription('Set the moderation log channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel for mod logs')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    
    try {
      const { guildConfig } = await import('../database/db.js');
      guildConfig.setModLogChannel(interaction.guildId, channel.id);
      
      await interaction.reply({ 
        content: `✅ Moderation log channel set to ${channel}.`, 
        ephemeral: true 
      });
      
    } catch (error) {
      console.error('Set mod log error:', error);
      await interaction.reply({ content: 'An error occurred.', ephemeral: true });
    }
  }
};

// Warns command - Check warnings
export const warnsCommand = {
  data: new SlashCommandBuilder()
    .setName('warns')
    .setDescription('Check warnings for a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to check warnings for')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    
    try {
      const stats = getUserStats(interaction.guildId, user.id);
      
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('⚠️ User Warnings')
        .setDescription(`**User:** ${user.tag}`)
        .addFields(
          { name: 'Trial Stage', value: getTrialName(stats.trialStage), inline: true },
          { name: 'Warnings', value: `${stats.warnCount}/${stats.maxWarns}`, inline: true },
          { name: 'Until Ban', value: `${stats.warnsUntilBan} more`, inline: true }
        );
      
      if (stats.banAppealDate) {
        const canAppeal = stats.canAppeal ? '✅ Can appeal now' : '⏳ Pending';
        embed.addFields({
          name: 'Appeal Status',
          value: `${canAppeal}\nAvailable: <t:${Math.floor(stats.banAppealDate.getTime() / 1000)}:R>`
        });
      }
      
      if (stats.isPermanent) {
        embed.addFields({ name: 'Status', value: '🔒 Permanent Ban (Great Trial)' });
      }
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      
    } catch (error) {
      console.error('Warns command error:', error);
      await interaction.reply({ content: 'An error occurred.', ephemeral: true });
    }
  }
};

// Clear warnings command (admin only)
export const clearwarnsCommand = {
  data: new SlashCommandBuilder()
    .setName('clearwarns')
    .setDescription('Clear all warnings for a user (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to clear warnings for')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    
    try {
      clearUserWarnings(interaction.guildId, user.id);
      
      await interaction.reply({ 
        content: `✅ Cleared all warnings for ${user.tag}.`, 
        ephemeral: true 
      });
      
    } catch (error) {
      console.error('Clear warnings error:', error);
      await interaction.reply({ content: 'An error occurred.', ephemeral: true });
    }
  }
};

// Moderation stats command
export const modstatsCommand = {
  data: new SlashCommandBuilder()
    .setName('modstats')
    .setDescription('Show moderation history and trial stage for a user')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to check')
        .setRequired(true)
    ),
  
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    
    try {
      const stats = getUserStats(interaction.guildId, user.id);
      
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📊 Moderation Statistics')
        .setDescription(`**User:** ${user.tag}`)
        .addFields(
          { name: 'Current Trial', value: getTrialName(stats.trialStage), inline: true },
          { name: 'Warnings', value: `${stats.warnCount}/${stats.maxWarns}`, inline: true },
          { name: 'Until Ban', value: `${stats.warnsUntilBan} more`, inline: true }
        );
      
      if (stats.banAppealDate) {
        embed.addFields({
          name: 'Ban Appeal',
          value: `Available: <t:${Math.floor(stats.banAppealDate.getTime() / 1000)}:R>\nStatus: ${stats.canAppeal ? '✅ Can appeal' : '⏳ Pending'}`
        });
      }
      
      if (stats.isPermanent) {
        embed.addFields({ name: 'Status', value: '🔒 Permanent Ban - No Appeal' });
      }
      
      // Recent history
      if (stats.history.length > 0) {
        const historyText = stats.history
          .slice(0, 5)
          .map(h => {
            const date = new Date(h.created_at * 1000);
            return `• **${h.action}** - <t:${h.created_at}:R>`;
          })
          .join('\n');
        
        embed.addFields({ name: 'Recent History', value: historyText });
      }
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      
    } catch (error) {
      console.error('Modstats command error:', error);
      await interaction.reply({ content: 'An error occurred.', ephemeral: true });
    }
  }
};

// Prefix command handlers
export async function handlePrefixModeration(message, command, args) {
  if (!message.guild) {
    await message.reply('This command can only be used in a server.');
    return;
  }
  
  // Check permissions
  const hasPermission = (perm) => {
    return message.member.permissions.has(perm);
  };
  
  // Parse user mention or ID
  const getUserFromArg = async (arg) => {
    if (!arg) return null;
    const match = arg.match(/^<@!?(\d+)>$/) || arg.match(/^(\d+)$/);
    if (!match) return null;
    try {
      return await message.client.users.fetch(match[1]);
    } catch {
      return null;
    }
  };
  
  switch (command) {
    case 'warn': {
      if (!hasPermission(PermissionFlagsBits.ModerateMembers)) {
        await message.reply('You need Moderate Members permission.');
        return;
      }
      
      const user = await getUserFromArg(args[0]);
      if (!user) {
        await message.reply('Please mention a user or provide a user ID.');
        return;
      }
      
      if (user.bot) {
        await message.reply('Cannot warn bots.');
        return;
      }
      
      const reason = args.slice(1).join(' ') || 'No reason provided';
      
      try {
        const result = processWarning(
          message.guild.id,
          user.id,
          message.author.id,
          reason
        );
        
        const embed = new EmbedBuilder()
          .setColor(result.banned ? 0xFF0000 : 0xFFAA00)
          .setTitle(result.banned ? '⚠️ User Banned' : '⚠️ User Warned')
          .setDescription(`**User:** ${user.tag}\n**Moderator:** ${message.author.tag}`);
        
        if (result.banned) {
          embed.addFields(
            { name: 'Trial Stage', value: getTrialName(result.trialStage), inline: true },
            { name: 'Warnings', value: `${result.warnCount}/${result.warnCount}`, inline: true }
          );
          
          if (result.appealDate) {
            embed.addFields({
              name: 'Appeal Available',
              value: `<t:${Math.floor(result.appealDate.getTime() / 1000)}:R>`
            });
          } else {
            embed.addFields({ name: 'Appeal', value: 'Permanent ban - No appeal' });
          }
          
          embed.addFields({ name: 'Next Trial', value: getTrialName(result.nextStage) });
          
          try {
            const member = await message.guild.members.fetch(user.id);
            await member.ban({ reason: `${getTrialName(result.trialStage)} completed: ${reason}` });
            embed.setFooter({ text: 'User has been banned from the server.' });
          } catch (error) {
            embed.setFooter({ text: 'Failed to ban user - insufficient permissions.' });
          }
        } else {
          const stats = getUserStats(message.guild.id, user.id);
          embed.addFields(
            { name: 'Trial Stage', value: getTrialName(result.trialStage), inline: true },
            { name: 'Warnings', value: `${result.warnCount}/${stats.maxWarns}`, inline: true },
            { name: 'Until Ban', value: `${stats.warnsUntilBan} more`, inline: true }
          );
        }
        
        embed.addFields({ name: 'Reason', value: reason });
        await message.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Warn command error:', error);
        await message.reply('An error occurred.');
      }
      break;
    }
    
    case 'warns': {
      const user = await getUserFromArg(args[0]);
      if (!user) {
        await message.reply('Please mention a user or provide a user ID.');
        return;
      }
      
      try {
        const stats = getUserStats(message.guild.id, user.id);
        
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('⚠️ User Warnings')
          .setDescription(`**User:** ${user.tag}`)
          .addFields(
            { name: 'Trial Stage', value: getTrialName(stats.trialStage), inline: true },
            { name: 'Warnings', value: `${stats.warnCount}/${stats.maxWarns}`, inline: true },
            { name: 'Until Ban', value: `${stats.warnsUntilBan} more`, inline: true }
          );
        
        if (stats.banAppealDate) {
          const canAppeal = stats.canAppeal ? '✅ Can appeal now' : '⏳ Pending';
          embed.addFields({
            name: 'Appeal Status',
            value: `${canAppeal}\nAvailable: <t:${Math.floor(stats.banAppealDate.getTime() / 1000)}:R>`
          });
        }
        
        if (stats.isPermanent) {
          embed.addFields({ name: 'Status', value: '🔒 Permanent Ban (Great Trial)' });
        }
        
        await message.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Warns command error:', error);
        await message.reply('An error occurred.');
      }
      break;
    }
    
    case 'modstats': {
      const user = await getUserFromArg(args[0]);
      if (!user) {
        await message.reply('Please mention a user or provide a user ID.');
        return;
      }
      
      try {
        const stats = getUserStats(message.guild.id, user.id);
        
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('📊 Moderation Statistics')
          .setDescription(`**User:** ${user.tag}`)
          .addFields(
            { name: 'Current Trial', value: getTrialName(stats.trialStage), inline: true },
            { name: 'Warnings', value: `${stats.warnCount}/${stats.maxWarns}`, inline: true },
            { name: 'Until Ban', value: `${stats.warnsUntilBan} more`, inline: true }
          );
        
        if (stats.banAppealDate) {
          embed.addFields({
            name: 'Ban Appeal',
            value: `Available: <t:${Math.floor(stats.banAppealDate.getTime() / 1000)}:R>\nStatus: ${stats.canAppeal ? '✅ Can appeal' : '⏳ Pending'}`
          });
        }
        
        if (stats.isPermanent) {
          embed.addFields({ name: 'Status', value: '🔒 Permanent Ban - No Appeal' });
        }
        
        if (stats.history.length > 0) {
          const historyText = stats.history
            .slice(0, 5)
            .map(h => `• **${h.action}** - <t:${h.created_at}:R>`)
            .join('\n');
          
          embed.addFields({ name: 'Recent History', value: historyText });
        }
        
        await message.reply({ embeds: [embed] });
      } catch (error) {
        console.error('Modstats command error:', error);
        await message.reply('An error occurred.');
      }
      break;
    }
    
    case 'clearwarns': {
      if (!hasPermission(PermissionFlagsBits.Administrator)) {
        await message.reply('You need Administrator permission.');
        return;
      }
      
      const user = await getUserFromArg(args[0]);
      if (!user) {
        await message.reply('Please mention a user or provide a user ID.');
        return;
      }
      
      try {
        clearUserWarnings(message.guild.id, user.id);
        await message.reply(`✅ Cleared all warnings for ${user.tag}.`);
      } catch (error) {
        console.error('Clear warnings error:', error);
        await message.reply('An error occurred.');
      }
      break;
    }
    
    default:
      await message.reply(`For moderation commands like \`!${command}\`, please use the slash command version \`/${command}\` for full functionality.`);
  }
}
