const { SlashCommandBuilder } = require('@discordjs/builders');
const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveperms')
        .setDescription('Creates a role and assigns it to a user')
        .addStringOption(option =>
            option.setName('rolename')
                .setDescription('The name of the role to create')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('The color of the role (hex format: #RRGGBB)')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to give the role to')
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
            const POSITION_ABOVE_ROLE_ID = '1274576214127804436';
            
            // Hardcoded role ID to also give to the user
            const ADDITIONAL_ROLE_ID = '1007422725113008178';
            
            // Validate color format
            if (!colorHex.match(/^#[0-9A-Fa-f]{6}$/)) {
                return await interaction.editReply('Invalid color format. Please use hex format (e.g., #FF0000 for red).');
            }
            
            // Convert hex to decimal for Discord's color system
            const colorDecimal = parseInt(colorHex.substring(1), 16);
            
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
            const additionalRole = interaction.guild.roles.cache.get(ADDITIONAL_ROLE_ID);
            if (!additionalRole) {
                return await interaction.editReply('Additional role not found. Please check the hardcoded role ID.');
            }
            
            // Assign both roles to the user
            await targetMember.roles.add(newRole);
            await targetMember.roles.add(additionalRole);
            
            await interaction.editReply({
                content: `Successfully created role "${roleName}" with color ${colorHex} and assigned it to ${targetUser.tag} along with the ${additionalRole.name} role.`
            });
            
        } catch (error) {
            console.error(error);
            await interaction.editReply({
                content: 'There was an error while executing this command. Make sure the bot has the necessary permissions.'
            });
        }
    },
};
