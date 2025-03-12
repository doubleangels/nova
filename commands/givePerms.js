const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveperms')
        .setDescription('Gives user permissions in the server.')
        .addStringOption(option =>
            option.setName('rolename')
                .setDescription("What do you want the name of the user's role to be?")
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription("What color should the user's role be? (#RRGGBB or RRGGBB)")
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('What user should receive the role?')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    
    async execute(interaction) {
        // Defer reply since this might take a moment
        await interaction.deferReply();
        
        try {
            const roleName = interaction.options.getString('rolename');
            const colorHex = interaction.options.getString('color');
            const targetUser = interaction.options.getUser('user');
            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            
            // Hardcoded role ID that the new role should be positioned above
            const POSITION_ABOVE_ROLE_ID = config.givePermsPositionAboveRoleId;
            
            // Hardcoded role ID to also give to the user
            const FREN_ROLE_ID = config.givePermsFrenRoleId;
            
            // Validate and normalize color format
            let normalizedColorHex = colorHex;
            if (colorHex.match(/^[0-9A-Fa-f]{6}$/)) {
                // If it's just RRGGBB without #, add the #
                normalizedColorHex = `#${colorHex}`;
            } else if (!colorHex.match(/^#[0-9A-Fa-f]{6}$/)) {
                // If it doesn't match either format, it's invalid
                return await interaction.editReply('Invalid color format. Please use the format #RRGGBB or RRGGBB.');
            }

            // Convert hex to decimal for Discord's color system
            const colorDecimal = parseInt(normalizedColorHex.replace('#', ''), 16);
            
            // Get the reference role for positioning
            const positionRole = interaction.guild.roles.cache.get(POSITION_ABOVE_ROLE_ID);
            if (!positionRole) {
                return await interaction.editReply('Reference role for positioning not found. Please check the hardcoded role ID.');
            }
            
            // Create the new role
            const newRole = await interaction.guild.roles.create({
                name: roleName,
                color: colorDecimal,
                position: positionRole.position + 1,
                reason: `Role created by ${interaction.user.tag} using giveperms command`
            });
            
            // Get the additional role to assign
            const additionalRole = interaction.guild.roles.cache.get(FREN_ROLE_ID);
            if (!additionalRole) {
                return await interaction.editReply('Additional role not found. Please check the Fren role ID.');
            }
            
            // Assign both roles to the user
            await targetMember.roles.add(newRole);
            await targetMember.roles.add(additionalRole);
            
            await interaction.editReply({
                content: `Successfully gave ${targetUser.tag} permissions in the server!`
            });
            
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: 'There was an error while executing this command. Make sure the bot has the necessary permissions.'
            });
        }
    },
};
