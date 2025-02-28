const { SlashCommandBuilder } = require('@discordjs/builders');
const { CommandInteraction, MessageAttachment } = require('discord.js');
const axios = require('axios');
const dayjs = require('dayjs');
const { createCanvas, loadImage } = require('canvas');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warp')
    .setDescription("Apply a warp effect to a user's profile picture.")
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Select a user to warp their profile picture.')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('mode')
        .setDescription('Select the warp mode.')
        .setRequired(true)
        .addChoices(
          { name: 'Swirl', value: 'swirl' },
          { name: 'Bulge', value: 'bulge' },
          { name: 'Ripple', value: 'ripple' },
          { name: 'Fisheye', value: 'fisheye' }
        )
    )
    .addIntegerOption(option =>
      option
        .setName('strength')
        .setDescription('Warp strength (0-6, Default: 6).')
        .setRequired(false)
        .setMinValue(0)
        .setMaxValue(6)
    ),

  /**
   * @param {CommandInteraction} interaction
   */
  async execute(interaction) {
    await interaction.deferReply();
    const timestamp = dayjs().format();
    const user = interaction.options.getUser('user');
    const mode = interaction.options.getString('mode');
    const strength = interaction.options.getInteger('strength') ?? 6;

    console.log(`[${timestamp}] /warp command invoked by ${interaction.user.username}`);
    console.log(`[${timestamp}] Target user: ${user.username}, Mode: ${mode}, Strength: ${strength}`);

    // Get the user's avatar URL in PNG format
    const avatarUrl = user.displayAvatarURL({ format: 'png', size: 512 });
    if (!avatarUrl) {
      return interaction.editReply('❌ This user has no profile picture.');
    }

    let imageBuffer;
    try {
      const response = await axios.get(avatarUrl, { responseType: 'arraybuffer' });
      imageBuffer = Buffer.from(response.data, 'binary');
    } catch (error) {
      console.error(`[${dayjs().format()}] Failed to fetch image for ${user.username}: ${error}`);
      return interaction.editReply('❌ Failed to fetch profile picture.');
    }

    let image;
    try {
      image = await loadImage(imageBuffer);
    } catch (error) {
      console.error(`[${dayjs().format()}] Error loading image: ${error}`);
      return interaction.editReply('❌ Error processing profile picture.');
    }

    const width = image.width;
    const height = image.height;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);

    // If strength is 0, return the original image
    if (strength === 0) {
      const attachment = new MessageAttachment(canvas.toBuffer(), 'original.png');
      console.log(`[${dayjs().format()}] Sent unmodified image (Strength 0)`);
      return interaction.editReply({ files: [attachment] });
    }

    // Define parameters for warp effect
    const strengthMap = { 0: 0, 1: 0.05, 2: 0.1, 3: 0.2, 4: 0.3, 5: 0.5, 6: 0.7 };
    const effectStrength = strengthMap[strength] || 0.3;
    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const effectRadius = Math.min(width, height) / 2;
    console.log(`[${dayjs().format()}] Warp center: (${centerX}, ${centerY}), Effect strength: ${effectStrength}`);

    // Get image pixel data
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const output = ctx.createImageData(width, height);
    const outData = output.data;

    // Loop over every pixel and apply the selected warp transformation
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        let newX = x;
        let newY = y;

        if (mode === 'swirl') {
          const angle = Math.atan2(dy, dx);
          const warpedAngle = angle + (7 * effectStrength * Math.exp(-distance / effectRadius));
          newX = Math.floor(centerX + distance * Math.cos(warpedAngle));
          newY = Math.floor(centerY + distance * Math.sin(warpedAngle));
        } else if (mode === 'bulge') {
          const normalizedDistance = distance / effectRadius;
          let bulgeFactor = 1 + effectStrength * (normalizedDistance ** 2 - 1);
          bulgeFactor = Math.min(Math.max(bulgeFactor, 0.5), 3.0);
          newX = Math.floor(centerX + bulgeFactor * dx);
          newY = Math.floor(centerY + bulgeFactor * dy);
        } else if (mode === 'ripple') {
          const wavelength = effectRadius / 5;
          const amplitude = effectStrength * effectRadius * 0.1;
          newX = Math.floor(x + amplitude * Math.sin((2 * Math.PI * y) / wavelength));
          newY = Math.floor(y + amplitude * Math.sin((2 * Math.PI * x) / wavelength));
        } else if (mode === 'fisheye') {
          const normX = dx / effectRadius;
          const normY = dy / effectRadius;
          const r = Math.sqrt(normX * normX + normY * normY);
          const rSafe = r === 0 ? 1e-6 : r;
          const theta = Math.atan(r * effectStrength * 2);
          const factor = r > 0 ? theta / rSafe : 1;
          newX = Math.floor(centerX + normX * factor * effectRadius);
          newY = Math.floor(centerY + normY * factor * effectRadius);
        } else {
          // Should not reach here; fall back to original coordinates
          newX = x;
          newY = y;
        }

        // Clamp the new coordinates to image bounds
        newX = Math.max(0, Math.min(width - 1, newX));
        newY = Math.max(0, Math.min(height - 1, newY));

        const srcIndex = (newY * width + newX) * 4;
        const destIndex = (y * width + x) * 4;
        outData[destIndex] = data[srcIndex];
        outData[destIndex + 1] = data[srcIndex + 1];
        outData[destIndex + 2] = data[srcIndex + 2];
        outData[destIndex + 3] = data[srcIndex + 3];
      }
    }

    // Draw the transformed image
    ctx.putImageData(output, 0, 0);
    const buffer = canvas.toBuffer('image/png');
    const attachment = new MessageAttachment(buffer, `${mode}_warp.png`);
    console.log(`[${dayjs().format()}] Successfully applied ${mode} effect with strength ${strength} for ${user.username}`);
    return interaction.editReply({ files: [attachment] });
  },
};
