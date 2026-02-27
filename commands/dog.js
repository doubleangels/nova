const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');

/**
 * Command module for fetching and displaying random dog images.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('dog')
    .setDescription('Fetch and display a random dog image.')
    .setDefaultMemberPermissions(null)
    .addStringOption(option =>
      option
        .setName('breed')
        .setDescription('Optional specific breed.')
        .setRequired(false)
        .addChoices(
          { name: 'Affenpinscher', value: 'affenpinscher' },
          { name: 'Wild African', value: 'african-wild' },
          { name: 'Airedale', value: 'airedale' },
          { name: 'Akita', value: 'akita' },
          { name: 'Appenzeller', value: 'appenzeller' },
          { name: 'Australian Kelpie', value: 'australian-kelpie' },
          { name: 'Australian Shepherd', value: 'australian-shepherd' },
          { name: 'Indian Bakharwal', value: 'bakharwal-indian' },
          { name: 'Basenji', value: 'basenji' },
          { name: 'Beagle', value: 'beagle' },
          { name: 'Bluetick', value: 'bluetick' },
          { name: 'Borzoi', value: 'borzoi' },
          { name: 'Bouvier', value: 'bouvier' },
          { name: 'Boxer', value: 'boxer' },
          { name: 'Brabancon', value: 'brabancon' },
          { name: 'Briard', value: 'briard' },
          { name: 'Norwegian Buhund', value: 'buhund-norwegian' },
          { name: 'Boston Bulldog', value: 'bulldog-boston' },
          { name: 'English Bulldog', value: 'bulldog-english' },
          { name: 'French Bulldog', value: 'bulldog-french' },
          { name: 'Staffordshire Bullterrier', value: 'bullterrier-staffordshire' },
          { name: 'Australian Cattledog', value: 'cattledog-australian' },
          { name: 'Cavapoo', value: 'cavapoo' },
          { name: 'Chihuahua', value: 'chihuahua' },
          { name: 'Indian Chippiparai', value: 'chippiparai-indian' },
          { name: 'Chow', value: 'chow' },
          { name: 'Clumber', value: 'clumber' },
          { name: 'Cockapoo', value: 'cockapoo' },
          { name: 'Border Collie', value: 'collie-border' },
          { name: 'Coonhound', value: 'coonhound' },
          { name: 'Cardigan Corgi', value: 'corgi-cardigan' },
          { name: 'Cotondetulear', value: 'cotondetulear' },
          { name: 'Dachshund', value: 'dachshund' },
          { name: 'Dalmatian', value: 'dalmatian' },
          { name: 'Great Dane', value: 'dane-great' },
          { name: 'Swedish Danish', value: 'danish-swedish' },
          { name: 'Scottish Deerhound', value: 'deerhound-scottish' },
          { name: 'Dhole', value: 'dhole' },
          { name: 'Dingo', value: 'dingo' },
          { name: 'Doberman', value: 'doberman' },
          { name: 'Norwegian Elkhound', value: 'elkhound-norwegian' },
          { name: 'Entlebucher', value: 'entlebucher' },
          { name: 'Eskimo', value: 'eskimo' },
          { name: 'Lapphund Finnish', value: 'finnish-lapphund' },
          { name: 'Bichon Frise', value: 'frise-bichon' },
          { name: 'Indian Gaddi', value: 'gaddi-indian' },
          { name: 'German Shepherd', value: 'german-shepherd' },
          { name: 'Indian Greyhound', value: 'greyhound-indian' },
          { name: 'Italian Greyhound', value: 'greyhound-italian' },
          { name: 'Groenendael', value: 'groenendael' },
          { name: 'Havanese', value: 'havanese' },
          { name: 'Afghan Hound', value: 'hound-afghan' },
          { name: 'Basset Hound', value: 'hound-basset' },
          { name: 'Blood Hound', value: 'hound-blood' },
          { name: 'English Hound', value: 'hound-english' },
          { name: 'Ibizan Hound', value: 'hound-ibizan' },
          { name: 'Plott Hound', value: 'hound-plott' },
          { name: 'Walker Hound', value: 'hound-walker' },
          { name: 'Husky', value: 'husky' },
          { name: 'Keeshond', value: 'keeshond' },
          { name: 'Kelpie', value: 'kelpie' },
          { name: 'Kombai', value: 'kombai' },
          { name: 'Komondor', value: 'komondor' },
          { name: 'Kuvasz', value: 'kuvasz' },
          { name: 'Labradoodle', value: 'labradoodle' },
          { name: 'Labrador', value: 'labrador' },
          { name: 'Leonberg', value: 'leonberg' },
          { name: 'Lhasa', value: 'lhasa' },
          { name: 'Malamute', value: 'malamute' },
          { name: 'Malinois', value: 'malinois' },
          { name: 'Maltese', value: 'maltese' },
          { name: 'Bull Mastiff', value: 'mastiff-bull' },
          { name: 'English Mastiff', value: 'mastiff-english' },
          { name: 'Indian Mastiff', value: 'mastiff-indian' },
          { name: 'Tibetan Mastiff', value: 'mastiff-tibetan' },
          { name: 'Mexicanhairless', value: 'mexicanhairless' },
          { name: 'Mix', value: 'mix' },
          { name: 'Bernese Mountain', value: 'mountain-bernese' },
          { name: 'Swiss Mountain', value: 'mountain-swiss' },
          { name: 'Indian Mudhol', value: 'mudhol-indian' },
          { name: 'Newfoundland', value: 'newfoundland' },
          { name: 'Otterhound', value: 'otterhound' },
          { name: 'Caucasian Ovcharka', value: 'ovcharka-caucasian' },
          { name: 'Papillon', value: 'papillon' },
          { name: 'Indian Pariah', value: 'pariah-indian' },
          { name: 'Pekinese', value: 'pekinese' },
          { name: 'Pembroke', value: 'pembroke' },
          { name: 'Miniature Pinscher', value: 'pinscher-miniature' },
          { name: 'Pitbull', value: 'pitbull' },
          { name: 'German Pointer', value: 'pointer-german' },
          { name: 'Germanlonghair Pointer', value: 'pointer-germanlonghair' },
          { name: 'Pomeranian', value: 'pomeranian' },
          { name: 'Medium Poodle', value: 'poodle-medium' },
          { name: 'Miniature Poodle', value: 'poodle-miniature' },
          { name: 'Standard Poodle', value: 'poodle-standard' },
          { name: 'Toy Poodle', value: 'poodle-toy' },
          { name: 'Pug', value: 'pug' },
          { name: 'Puggle', value: 'puggle' },
          { name: 'Pyrenees', value: 'pyrenees' },
          { name: 'Indian Rajapalayam', value: 'rajapalayam-indian' },
          { name: 'Redbone', value: 'redbone' },
          { name: 'Chesapeake Retriever', value: 'retriever-chesapeake' },
          { name: 'Curly Retriever', value: 'retriever-curly' },
          { name: 'Flatcoated Retriever', value: 'retriever-flatcoated' },
          { name: 'Golden Retriever', value: 'retriever-golden' },
          { name: 'Rhodesian Ridgeback', value: 'ridgeback-rhodesian' },
          { name: 'Rottweiler', value: 'rottweiler' },
          { name: 'Collie Rough', value: 'rough-collie' },
          { name: 'Saluki', value: 'saluki' },
          { name: 'Samoyed', value: 'samoyed' },
          { name: 'Schipperke', value: 'schipperke' },
          { name: 'Giant Schnauzer', value: 'schnauzer-giant' },
          { name: 'Miniature Schnauzer', value: 'schnauzer-miniature' },
          { name: 'Italian Segugio', value: 'segugio-italian' },
          { name: 'English Setter', value: 'setter-english' },
          { name: 'Gordon Setter', value: 'setter-gordon' },
          { name: 'Irish Setter', value: 'setter-irish' },
          { name: 'Sharpei', value: 'sharpei' },
          { name: 'English Sheepdog', value: 'sheepdog-english' },
          { name: 'Indian Sheepdog', value: 'sheepdog-indian' },
          { name: 'Shetland Sheepdog', value: 'sheepdog-shetland' },
          { name: 'Shiba', value: 'shiba' },
          { name: 'Shihtzu', value: 'shihtzu' },
          { name: 'Blenheim Spaniel', value: 'spaniel-blenheim' },
          { name: 'Brittany Spaniel', value: 'spaniel-brittany' },
          { name: 'Cocker Spaniel', value: 'spaniel-cocker' },
          { name: 'Irish Spaniel', value: 'spaniel-irish' },
          { name: 'Japanese Spaniel', value: 'spaniel-japanese' },
          { name: 'Sussex Spaniel', value: 'spaniel-sussex' },
          { name: 'Welsh Spaniel', value: 'spaniel-welsh' },
          { name: 'Indian Spitz', value: 'spitz-indian' },
          { name: 'Japanese Spitz', value: 'spitz-japanese' },
          { name: 'English Springer', value: 'springer-english' },
          { name: 'Stbernard', value: 'stbernard' },
          { name: 'American Terrier', value: 'terrier-american' },
          { name: 'Andalusian Terrier', value: 'terrier-andalusian' },
          { name: 'Australian Terrier', value: 'terrier-australian' },
          { name: 'Bedlington Terrier', value: 'terrier-bedlington' },
          { name: 'Border Terrier', value: 'terrier-border' },
          { name: 'Boston Terrier', value: 'terrier-boston' },
          { name: 'Cairn Terrier', value: 'terrier-cairn' },
          { name: 'Dandie Terrier', value: 'terrier-dandie' },
          { name: 'Fox Terrier', value: 'terrier-fox' },
          { name: 'Irish Terrier', value: 'terrier-irish' },
          { name: 'Kerryblue Terrier', value: 'terrier-kerryblue' },
          { name: 'Lakeland Terrier', value: 'terrier-lakeland' },
          { name: 'Norfolk Terrier', value: 'terrier-norfolk' },
          { name: 'Norwich Terrier', value: 'terrier-norwich' },
          { name: 'Patterdale Terrier', value: 'terrier-patterdale' },
          { name: 'Russell Terrier', value: 'terrier-russell' },
          { name: 'Scottish Terrier', value: 'terrier-scottish' },
          { name: 'Sealyham Terrier', value: 'terrier-sealyham' },
          { name: 'Silky Terrier', value: 'terrier-silky' },
          { name: 'Tibetan Terrier', value: 'terrier-tibetan' },
          { name: 'Toy Terrier', value: 'terrier-toy' },
          { name: 'Welsh Terrier', value: 'terrier-welsh' },
          { name: 'Westhighland Terrier', value: 'terrier-westhighland' },
          { name: 'Wheaten Terrier', value: 'terrier-wheaten' },
          { name: 'Yorkshire Terrier', value: 'terrier-yorkshire' },
          { name: 'Tervuren', value: 'tervuren' },
          { name: 'Vizsla', value: 'vizsla' },
          { name: 'Spanish Waterdog', value: 'waterdog-spanish' },
          { name: 'Irish Wolfhound', value: 'wolfhound-irish' },
          { name: 'Weimaraner', value: 'weimaraner' },
          { name: 'Whippet', value: 'whippet' }
        )
    ),

  /**
   * Executes the dog image command.
   * This function:
   * 1. Fetches a random dog image from the Dog CEO API
   * 2. Creates and sends an embed with the image
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error fetching or displaying the image
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      
      logger.info("/dog command initiated.", {
        userId: interaction.user.id,
        guildId: interaction.guild?.id
      });
      
      const breed = interaction.options.getString('breed');
      let apiUrl = "https://dog.ceo/api/breeds/image/random";

      if (breed) {
        const breedPath = breed.replace('-', '/');
        apiUrl = `https://dog.ceo/api/breed/${breedPath}/images/random`;
      }

      const response = await axios.get(apiUrl);
      const dogData = response.data;
      
      if (!dogData.message) {
        throw new Error("NO_IMAGE_URL");
      }
      
      const embed = new EmbedBuilder()
        .setColor(0xA0522D)
        .setTitle('Random Dog')
        .setImage(dogData.message)
        .setFooter({ text: 'Powered by Dog CEO API' });
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info("/dog command completed successfully.", {
        userId: interaction.user.id,
        imageUrl: dogData.message
      });
    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Handles errors that occur during command execution.
   * Logs the error and sends an appropriate error message to the user.
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @param {Error} error - The error that occurred
   * @returns {Promise<void>}
   */
  async handleError(interaction, error) {
    logger.error("Error occurred in dog command.", {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while fetching the dog image. Please try again later.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Couldn't fetch a dog picture due to an API error. Try again later.";
    } else if (error.message === "NO_IMAGE_URL") {
      errorMessage = "⚠️ Couldn't find a dog picture. Try again later.";
    } else if (error.message === "IMAGE_FETCH_ERROR") {
      errorMessage = "⚠️ Couldn't download the dog picture. Try again later.";
    } else if (error.message === "NETWORK_ERROR") {
      errorMessage = "⚠️ Network error: Could not connect to the service. Please check your internet connection.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for dog command.", {
        err: followUpError,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        flags: MessageFlags.Ephemeral 
      }).catch(() => {});
    }
  }
};