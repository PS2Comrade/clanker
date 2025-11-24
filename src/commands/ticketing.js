import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { tickets } from '../database/db.js';

const TICKET_TYPE_EMOJIS = {
  appeal: '⚖️',
  support: '🎫',
  bug: '🐛'
};

const TICKET_TYPE_NAMES = {
  appeal: 'Appeal',
  support: 'Support',
  bug: 'Bug Report'
};

export const ticketCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create a ticket')
    .addStringOption(option =>
      option.setName('type')
        .setDescription('Ticket type')
        .setRequired(true)
        .addChoices(
          { name: 'Appeal', value: 'appeal' },
          { name: 'Support', value: 'support' },
          { name: 'Bug Report', value: 'bug' }
        )
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for the ticket')
        .setRequired(true)
    ),

  async execute(interaction) {
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason');

    await interaction.deferReply({ ephemeral: true });

    try {
      const { id: ticketId, ticketNumber } = tickets.create(
        interaction.guildId,
        type,
        interaction.user.id,
        reason
      );

      const channelName = `ticket-${ticketNumber}`;
      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          },
          {
            id: interaction.client.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels]
          }
        ]
      });

      tickets.setChannelId(ticketId, channel.id);

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${TICKET_TYPE_EMOJIS[type]} ${TICKET_TYPE_NAMES[type]} #${ticketNumber}`)
        .setDescription(`**Creator:** ${interaction.user.tag}\n**Reason:** ${reason}`)
        .addFields(
          { name: 'Status', value: '🟢 Open', inline: true },
          { name: 'Claimed By', value: 'None', inline: true }
        )
        .setTimestamp();

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket_claim_${ticketId}`)
            .setLabel('Claim')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✋'),
          new ButtonBuilder()
            .setCustomId(`ticket_close_${ticketId}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒')
        );

      await channel.send({ embeds: [embed], components: [row] });

      await interaction.editReply({
        content: `✅ Ticket #${ticketNumber} created: ${channel}`
      });

    } catch (error) {
      console.error('Ticket creation error:', error);
      await interaction.editReply({
        content: 'Failed to create ticket. Please check bot permissions.'
      });
    }
  }
};

export const ticketListCommand = {
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('List open tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const openTickets = tickets.getOpen(interaction.guildId);

    if (openTickets.length === 0) {
      await interaction.reply({ content: 'No open tickets.', ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Open Tickets')
      .setDescription(openTickets.map(t => {
        const claimed = t.claimer_id ? `<@${t.claimer_id}>` : 'Unclaimed';
        return `${TICKET_TYPE_EMOJIS[t.type]} **#${t.ticket_number}** - <@${t.creator_id}> - ${claimed}`;
      }).join('\n'))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

export async function handleTicketButton(interaction) {
  const [action, subAction, ticketId] = interaction.customId.split('_');

  if (action !== 'ticket') return false;

  const ticket = tickets.get(parseInt(ticketId));
  if (!ticket) {
    await interaction.reply({ content: 'Ticket not found.', ephemeral: true });
    return true;
  }

  try {
    if (subAction === 'claim') {
      if (ticket.claimer_id) {
        await interaction.reply({ content: 'This ticket is already claimed.', ephemeral: true });
        return true;
      }

      tickets.claim(ticket.id, interaction.user.id);

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setFields(
          { name: 'Status', value: '🟢 Open', inline: true },
          { name: 'Claimed By', value: `<@${interaction.user.id}>`, inline: true }
        );

      await interaction.update({ embeds: [embed] });
      await interaction.followUp({ content: `✅ You have claimed this ticket.`, ephemeral: true });

    } else if (subAction === 'close') {
      if (ticket.status === 'closed') {
        await interaction.reply({ content: 'This ticket is already closed.', ephemeral: true });
        return true;
      }

      tickets.close(ticket.id);

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setFields(
          { name: 'Status', value: '🔴 Closed', inline: true },
          { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setColor(0xFF0000);

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket_reopen_${ticketId}`)
            .setLabel('Reopen')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔓')
        );

      await interaction.update({ embeds: [embed], components: [row] });

      const channel = interaction.channel;
      if (channel) {
        try {
          await channel.permissionOverwrites.edit(ticket.creator_id, {
            SendMessages: false
          });
        } catch (error) {
          console.error('Failed to edit channel permissions on ticket close:', error);
        }
      }

    } else if (subAction === 'reopen') {
      if (ticket.status === 'open') {
        await interaction.reply({ content: 'This ticket is already open.', ephemeral: true });
        return true;
      }

      tickets.reopen(ticket.id);

      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setFields(
          { name: 'Status', value: '🟢 Open', inline: true },
          { name: 'Reopened By', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setColor(0x5865F2);

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`ticket_claim_${ticketId}`)
            .setLabel('Claim')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✋'),
          new ButtonBuilder()
            .setCustomId(`ticket_close_${ticketId}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒')
        );

      await interaction.update({ embeds: [embed], components: [row] });

      const channel = interaction.channel;
      if (channel) {
        try {
          await channel.permissionOverwrites.edit(ticket.creator_id, {
            SendMessages: true
          });
        } catch (error) {
          console.error('Failed to edit channel permissions on ticket reopen:', error);
        }
      }
    }
  } catch (error) {
    console.error('Ticket button error:', error);
    await interaction.reply({ content: 'An error occurred.', ephemeral: true });
  }

  return true;
}
