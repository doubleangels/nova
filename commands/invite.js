const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType, MessageFlags } = require('discord.js');
const path = require('path');
const dayjs = require('dayjs');
const logger = require('../logger')(path.basename(__filename));
const { setInviteTag, getInviteTag, deleteInviteTag, setInviteNotificationChannel, getValue, setValue, getAllInviteTagsData, getInviteCodeToTagMap, setInviteCodeToTagMap } = require('../utils/database');

/**
 * Command module for managing invite codes with tags/names.
 * Allows users to store and retrieve invite codes with custom names.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Manage invite codes with custom tags/names.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('tag')
        .setDescription('Tag an invite code with a custom name.')
        .addStringOption(option =>
          option
            .setName('code')
            .setDescription('What is the invite code?')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('What is the name/tag to associate with this invite code?')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('setup')
        .setDescription('Set up the channel for invite notifications.')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('What channel do you want to send the invite notifications to?')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all tagged invite codes.')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new Discord invite and tag it.')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('What is the name/tag for this invite?')
            .setRequired(true)
        )
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('What channel do you want to create the invite for?')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildForum)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('max_uses')
            .setDescription('What is the maximum number of uses for this invite? (0 = unlimited)')
            .setMinValue(0)
            .setMaxValue(100)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('max_age')
            .setDescription('What is the maximum age in seconds for this invite? (0 = never expires)')
            .setMinValue(0)
            .setMaxValue(604800)
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a tagged invite.')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('What is the name/tag of the invite to remove?')
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  /**
   * Executes the invite command.
   * This function:
   * 1. Processes the subcommand (tag)
   * 2. Validates the invite code format
   * 3. Stores the invite code with its name in the database
   * 4. Displays confirmation message
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error processing the command
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();

      const subcommand = interaction.options.getSubcommand();

      logger.info(`/invite command initiated.`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand
      });

      switch (subcommand) {
        case 'tag':
          await this.handleTagSubcommand(interaction);
          break;
        case 'setup':
          await this.handleSetupSubcommand(interaction);
          break;
        case 'list':
          await this.handleListSubcommand(interaction);
          break;
        case 'create':
          await this.handleCreateSubcommand(interaction);
          break;
        case 'remove':
          await this.handleRemoveSubcommand(interaction);
          break;
        default:
          await interaction.editReply({
            content: '⚠️ Unknown subcommand.'
          });
      }

    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles the tag subcommand.
   * This function:
   * 1. Validates the invite code format
   * 2. Stores the invite code with its name in the database
   * 3. Displays confirmation message
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error processing the tag
   * @returns {Promise<void>}
   */
  async handleTagSubcommand(interaction) {
    const inviteCode = interaction.options.getString('code');
    const tagName = interaction.options.getString('name');

    // Validate invite code format (should be alphanumeric, typically 5-10 characters, but vanity invites can be longer)
    // Remove any URL parts if user pasted full URL
    let cleanCode = inviteCode.trim();

    // Extract code from URL if full URL was provided
    // Updated regex to handle vanity invites like discord.gg/dafrens
    const urlMatch = cleanCode.match(/(?:discord\.(?:gg|com\/invite)|discordapp\.com\/invite)\/([a-zA-Z0-9_-]+)/i);
    if (urlMatch) {
      cleanCode = urlMatch[1];
    }

    // Validate code format (alphanumeric, underscores, hyphens allowed; 5-25 characters to support vanity invites)
    const codePattern = /^[a-zA-Z0-9_-]{5,25}$/;
    if (!codePattern.test(cleanCode)) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Invalid Invite Code')
        .setDescription('Please provide a valid Discord invite code.\n\n**Examples:**\n- `xxxxx` (from discord.gg/xxxxx)\n- `https://discord.gg/xxxxx`\n- `discord.gg/xxxxx`\n- `discord.gg/dafrens` (vanity invite)');

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Check if tag already exists
    const existingTag = await getInviteTag(tagName);
    const isUpdate = existingTag !== null;

    // Store the invite code with its tag in the invites namespace
    const inviteData = {
      code: cleanCode,
      name: tagName,
      createdAt: isUpdate ? existingTag.createdAt : dayjs().toISOString(),
      updatedAt: dayjs().toISOString(),
      createdBy: isUpdate ? existingTag.createdBy : interaction.user.id,
      updatedBy: interaction.user.id
    };

    await setInviteTag(tagName, inviteData);

    // Validate that the invite exists in the server (skip check for "Vanity" tag since vanity invites may not appear in the invite list)
    if (tagName.toLowerCase() !== 'vanity') {
      try {
        const invites = await interaction.guild.invites.fetch();
        const inviteExists = invites.some(inv => inv.code.toLowerCase() === cleanCode.toLowerCase());
        if (!inviteExists) {
          const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('❌ Invite Not Found')
            .setDescription(`The invite code \`${cleanCode}\` does not exist in this server. Please verify the code is correct and the invite hasn't been deleted.`);

          await interaction.editReply({ embeds: [embed] });
          return;
        }
      } catch (fetchError) {
        logger.warn('Failed to validate invite existence, proceeding anyway.', {
          err: fetchError,
          code: cleanCode
        });
        // Continue if we can't validate (e.g., no permissions)
      }
    } else {
      logger.debug('Skipping invite existence check for Vanity tag.', {
        code: cleanCode,
        tagName: tagName
      });
    }

    // Update code-to-tag mapping for quick lookups
    const codeToTagMap = await getInviteCodeToTagMap(interaction.guildId) || {};

    // Check if code is already mapped to a different tag
    const existingMappedTag = codeToTagMap[cleanCode.toLowerCase()];
    if (existingMappedTag && existingMappedTag !== tagName) {
      logger.warn('Code already mapped to different tag, overwriting.', {
        code: cleanCode,
        existingTag: existingMappedTag,
        newTag: tagName
      });
    }

    // Remove old code mapping if tag was updated with a new code
    if (isUpdate && existingTag.code && existingTag.code.toLowerCase() !== cleanCode.toLowerCase()) {
      delete codeToTagMap[existingTag.code.toLowerCase()];
      logger.debug('Removed old code mapping.', {
        oldCode: existingTag.code.toLowerCase(),
        tagName: tagName
      });
    }

    // Add new code mapping
    codeToTagMap[cleanCode.toLowerCase()] = tagName;
    await setInviteCodeToTagMap(interaction.guildId, codeToTagMap);
    logger.debug('Updated code-to-tag mapping.', {
      code: cleanCode.toLowerCase(),
      tagName: tagName
    });

    const embed = new EmbedBuilder()
      .setColor(isUpdate ? 0xFFA500 : 0x00FF00)
      .setTitle(isUpdate ? 'Invite Tag Updated' : 'Invite Code Tagged')
      .setDescription(isUpdate
        ? `The tag **${tagName}** has been updated with a new invite code.`
        : `The invite code has been successfully tagged as **${tagName}**.`)
      .addFields(
        { name: 'Tag Name', value: tagName, inline: true },
        { name: 'Invite Code', value: cleanCode, inline: true },
        { name: 'Full URL', value: `https://discord.gg/${cleanCode}`, inline: false }
      );

    if (isUpdate && existingTag.code !== cleanCode) {
      embed.addFields(
        { name: 'Previous Code', value: existingTag.code, inline: true }
      );
    }

    embed.setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info("/invite tag command completed successfully.", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      tagName,
      code: cleanCode
    });
  },

  /**
   * Handles the setup subcommand.
   * This function:
   * 1. Validates the channel type
   * 2. Stores the notification channel in the database
   * 3. Displays confirmation message
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error processing the setup
   * @returns {Promise<void>}
   */
  async handleSetupSubcommand(interaction) {
    const channel = interaction.options.getChannel('channel');

    // Validate channel type
    if (channel.type !== ChannelType.GuildText) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Invalid Channel Type')
        .setDescription('Please select a text channel for invite notifications.');

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Store the notification channel in the invites namespace
    await setInviteNotificationChannel(channel.id);

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('Invite Notifications Configured')
      .setDescription('The notification channel has been successfully set up.')
      .addFields(
        { name: 'Notification Channel', value: `${channel}`, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info("/invite setup command completed successfully.", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: channel.id
    });
  },

  /**
   * Handles the list subcommand.
   * This function:
   * 1. Retrieves all tagged invites from the database
   * 2. Displays them in an embed
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error processing the list
   * @returns {Promise<void>}
   */
  async handleListSubcommand(interaction) {
    const tags = await getAllInviteTagsData();

    if (tags.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0xFFA500)
        .setTitle('Tagged Invites')
        .setDescription('No tagged invites found. Use `/invite tag` to create one.');

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Sort tags by name
    tags.sort((a, b) => a.name.localeCompare(b.name));

    const embed = new EmbedBuilder()
      .setColor(0x00FF00)
      .setTitle('Tagged Invites')
      .setDescription(`Found **${tags.length}** tagged invite${tags.length === 1 ? '' : 's'}:`)
      .setTimestamp();

    // Discord embeds have a limit of 25 fields and 6000 characters total
    // Group tags into fields, showing multiple tags per field if needed
    const fields = [];
    let currentField = { name: 'Tags', value: '', inline: false };

    for (const tag of tags) {
      const tagLine = `**${tag.name}**\n\`${tag.code}\` - https://discord.gg/${tag.code}\n`;

      // If adding this tag would exceed field length limit (1024 chars), start a new field
      if (currentField.value.length + tagLine.length > 1000 && currentField.value.length > 0) {
        fields.push(currentField);
        currentField = { name: '\u200b', value: '', inline: false };
      }

      currentField.value += tagLine;
    }

    // Add the last field if it has content
    if (currentField.value.length > 0) {
      fields.push(currentField);
    }

    // Add fields to embed (max 25 fields)
    for (let i = 0; i < Math.min(fields.length, 25); i++) {
      embed.addFields(fields[i]);
    }

    if (fields.length > 25) {
      embed.setFooter({ text: `Showing first 25 of ${tags.length} tags` });
    }

    await interaction.editReply({ embeds: [embed] });

    logger.info("/invite list command completed successfully.", {
      userId: interaction.user.id,
      guildId: interaction.guildId,
      tagCount: tags.length
    });
  },

  /**
   * Handles the create subcommand.
   * This function:
   * 1. Creates a new Discord invite
   * 2. Automatically tags it with the provided name
   * 3. Displays confirmation message
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error creating the invite
   * @returns {Promise<void>}
   */
  async handleCreateSubcommand(interaction) {
    const tagName = interaction.options.getString('name');
    const channelOption = interaction.options.getChannel('channel');
    const maxUses = interaction.options.getInteger('max_uses');
    const maxAge = interaction.options.getInteger('max_age');

    // Check if bot has permission to create invites
    if (!interaction.guild.members.me.permissions.has('CreateInstantInvite')) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Missing Permissions')
        .setDescription('The bot does not have permission to create invites. Please grant the "Create Instant Invite" permission.');

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Determine which channel to use
    let targetChannel = channelOption;

    if (!targetChannel) {
      // Find first available text channel
      targetChannel = interaction.guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(interaction.guild.members.me)?.has('CreateInstantInvite'))
        .first();

      if (!targetChannel) {
        const embed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('❌ No Channel Available')
          .setDescription('No text channel found where the bot can create invites. Please specify a channel or grant permissions.');

        await interaction.editReply({ embeds: [embed] });
        return;
      }
    }

    // Check if bot can create invites in the target channel
    if (!targetChannel.permissionsFor(interaction.guild.members.me)?.has('CreateInstantInvite')) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Missing Permissions')
        .setDescription(`The bot does not have permission to create invites in ${targetChannel}.`);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    try {
      // Create the invite
      const inviteOptions = {
        maxUses: maxUses || 0,
        maxAge: maxAge || 0,
        unique: true
      };

      const invite = await targetChannel.createInvite(inviteOptions);

      // Extract the invite code
      const inviteCode = invite.code;

      // Check if tag already exists
      const existingTag = await getInviteTag(tagName);
      const isUpdate = existingTag !== null;

      // Store the invite code with its tag
      const inviteData = {
        code: inviteCode,
        name: tagName,
        createdAt: isUpdate ? existingTag.createdAt : dayjs().toISOString(),
        updatedAt: dayjs().toISOString(),
        createdBy: isUpdate ? existingTag.createdBy : interaction.user.id,
        updatedBy: interaction.user.id
      };

      await setInviteTag(tagName, inviteData);

      // Update code-to-tag mapping
      const codeToTagMap = await getInviteCodeToTagMap(interaction.guildId) || {};

      // Check if code is already mapped to a different tag (shouldn't happen for newly created invites, but check anyway)
      const existingMappedTag = codeToTagMap[inviteCode.toLowerCase()];
      if (existingMappedTag && existingMappedTag !== tagName) {
        logger.warn('Code already mapped to different tag, overwriting.', {
          code: inviteCode,
          existingTag: existingMappedTag,
          newTag: tagName
        });
      }

      // Remove old code mapping if tag was updated
      if (isUpdate && existingTag.code && existingTag.code.toLowerCase() !== inviteCode.toLowerCase()) {
        delete codeToTagMap[existingTag.code.toLowerCase()];
        logger.debug('Removed old code mapping.', {
          oldCode: existingTag.code.toLowerCase(),
          tagName: tagName
        });
      }

      // Add new code mapping
      codeToTagMap[inviteCode.toLowerCase()] = tagName;
      await setInviteCodeToTagMap(interaction.guildId, codeToTagMap);
      logger.debug('Updated code-to-tag mapping.', {
        code: inviteCode.toLowerCase(),
        tagName: tagName
      });

      // Build embed
      const embed = new EmbedBuilder()
        .setColor(isUpdate ? 0xFFA500 : 0x00FF00)
        .setTitle(isUpdate ? 'Invite Created and Tag Updated' : 'Invite Created and Tagged')
        .setDescription(isUpdate
          ? `A new invite has been created and the tag **${tagName}** has been updated.`
          : `A new invite has been created and tagged as **${tagName}**.`)
        .addFields(
          { name: 'Tag Name', value: tagName, inline: true },
          { name: 'Invite Code', value: inviteCode, inline: true },
          { name: 'Channel', value: `${targetChannel}`, inline: true },
          { name: 'Full URL', value: `https://discord.gg/${inviteCode}`, inline: false }
        );

      // Add invite options if set
      if (maxUses && maxUses > 0) {
        embed.addFields({ name: 'Max Uses', value: maxUses.toString(), inline: true });
      }

      if (maxAge && maxAge > 0) {
        const days = Math.floor(maxAge / 86400);
        const hours = Math.floor((maxAge % 86400) / 3600);
        const ageText = days > 0 ? `${days} day${days !== 1 ? 's' : ''}` : `${hours} hour${hours !== 1 ? 's' : ''}`;
        embed.addFields({ name: 'Expires After', value: ageText, inline: true });
      }

      if (isUpdate && existingTag.code !== inviteCode) {
        embed.addFields(
          { name: 'Previous Code', value: existingTag.code, inline: true }
        );
      }

      embed.setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logger.info("/invite create command completed successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        tagName,
        code: inviteCode,
        channelId: targetChannel.id,
        maxUses: maxUses || 0,
        maxAge: maxAge || 0
      });

    } catch (error) {
      logger.error("Error occurred while creating invite.", {
        err: error,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });

      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Create Invite')
        .setDescription(`An error occurred while creating the invite: ${error.message}`);

      await interaction.editReply({ embeds: [embed] });
    }
  },

  /**
   * Handles the remove subcommand.
   * This function:
   * 1. Retrieves the invite tag
   * 2. Removes it from the database
   * 3. Removes it from the code-to-tag mapping
   * 4. Displays confirmation message
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error processing the removal
   * @returns {Promise<void>}
   */
  async handleRemoveSubcommand(interaction) {
    const tagName = interaction.options.getString('name');

    // Get the invite tag to verify it exists and get the code
    const inviteTag = await getInviteTag(tagName);

    if (!inviteTag) {
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Tag Not Found')
        .setDescription(`No tagged invite found with the name "${tagName}".\n\nUse \`/invite list\` to see all tagged invites.`);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    try {
      let inviteDeleted = false;
      let inviteDeleteError = null;

      // Try to delete the invite from Discord if we have the code
      if (inviteTag.code) {
        try {
          // Check if bot has permission to manage invites OR if bot created the invite
          const botMember = interaction.guild.members.me;
          const hasManageGuild = botMember?.permissions.has('ManageGuild');

          if (!hasManageGuild) {
            // Fetch invites to check if bot created this one
            const invites = await interaction.guild.invites.fetch().catch(() => null);
            if (invites) {
              const invite = invites.find(inv => inv.code === inviteTag.code);
              // Check if bot created the invite (inviter is the bot)
              if (invite && invite.inviter && invite.inviter.id === botMember?.id) {
                // Bot created it, can delete
                await invite.delete('Removed via /invite remove command');
                inviteDeleted = true;
                logger.debug('Deleted invite from Discord server (bot created it).', {
                  inviteCode: inviteTag.code
                });
              } else {
                logger.debug("Bot doesn't have ManageGuild permission and didn't create invite, cannot delete.");
                inviteDeleteError = "Bot lacks ManageGuild permission and didn't create this invite";
              }
            } else {
              logger.debug("Bot doesn't have ManageGuild permission, cannot fetch invites to check creator.");
              inviteDeleteError = "Bot lacks ManageGuild permission";
            }
          } else {
            // Bot has ManageGuild permission, can delete any invite
            const invites = await interaction.guild.invites.fetch();
            const invite = invites.find(inv => inv.code === inviteTag.code);

            if (invite) {
              await invite.delete('Removed via /invite remove command');
              inviteDeleted = true;
              logger.debug('Deleted invite from Discord server.', {
                inviteCode: inviteTag.code
              });
            } else {
              logger.debug('Invite not found in server, may have already been deleted.', {
                inviteCode: inviteTag.code
              });
              inviteDeleteError = "Invite not found in server";
            }
          }
        } catch (deleteError) {
          logger.warn('Failed to delete invite from Discord.', {
            err: deleteError,
            inviteCode: inviteTag.code
          });
          inviteDeleteError = deleteError.message;
        }
      }

      // Delete the invite tag from database
      await deleteInviteTag(tagName);

      // Remove from code-to-tag mapping
      const codeToTagMap = await getInviteCodeToTagMap(interaction.guildId) || {};
      if (inviteTag.code) {
        delete codeToTagMap[inviteTag.code.toLowerCase()];
        await setInviteCodeToTagMap(interaction.guildId, codeToTagMap);
        logger.debug('Removed code mapping.', {
          code: inviteTag.code.toLowerCase(),
          tagName: tagName
        });
      }

      // Build response embed
      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('Tagged Invite Removed')
        .setDescription(`The tagged invite **${tagName}** has been successfully removed.`)
        .addFields(
          { name: 'Tag Name', value: tagName, inline: true },
          { name: 'Invite Code', value: inviteTag.code || 'N/A', inline: true },
          { name: 'Full URL', value: inviteTag.code ? `https://discord.gg/${inviteTag.code}` : 'N/A', inline: false }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      logger.info("/invite remove command completed successfully.", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        tagName,
        code: inviteTag.code,
        inviteDeleted
      });

    } catch (error) {
      logger.error("Error occurred while removing invite tag.", {
        err: error,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        tagName
      });

      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('❌ Failed to Remove Tag')
        .setDescription(`An error occurred while removing the tag: ${error.message}`);

      await interaction.editReply({ embeds: [embed] });
    }
  },

  /**
   * Handles autocomplete for the remove subcommand name option.
   * 
   * @param {AutocompleteInteraction} interaction - The autocomplete interaction
   * @returns {Promise<void>}
   */
  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    if (focusedOption.name === 'name') {
      try {
        const tags = await getAllInviteTagsData();
        const query = focusedOption.value.toLowerCase();

        // Filter tags that match the query
        // Use both tagName and name for matching
        const filtered = tags
          .filter(tag => {
            const nameMatch = tag.name?.toLowerCase().includes(query);
            const tagNameMatch = tag.tagName?.toLowerCase().includes(query);
            return nameMatch || tagNameMatch;
          })
          .slice(0, 25) // Discord autocomplete limit
          .map(tag => ({
            name: tag.name || tag.tagName || 'Unknown',
            value: tag.tagName || tag.name || 'Unknown'
          }));

        await interaction.respond(filtered);
      } catch (error) {
        logger.error("Error occurred in autocomplete.", {
          err: error
        });
        await interaction.respond([]);
      }
    }
  },

  /**
   * Handles errors that occur during command execution.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error occurred in invite command.", {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });

    let errorMessage = "⚠️ An unexpected error occurred while processing the invite command.";

    if (error.message === "DATABASE_WRITE_ERROR") {
      errorMessage = "⚠️ Failed to save the invite tag. Please try again later.";
    } else if (error.message === "DATABASE_READ_ERROR") {
      errorMessage = "⚠️ Failed to retrieve invite tags. Please try again later.";
    }

    try {
      await interaction.editReply({
        content: errorMessage
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for invite command.", {
        err: followUpError,
        originalError: error.message,
        userId: interaction.user?.id
      });

      await interaction.reply({
        content: errorMessage
      }).catch(() => { });
    }
  }
};

