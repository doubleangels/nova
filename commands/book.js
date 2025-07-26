const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults } = require('../utils/searchUtils');

/**
 * Command module for searching and displaying book information using Google Books API.
 * Supports searching for books by title, author, ISBN, and general queries.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('book')
    .setDescription('Search for books using Google Books API.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('search')
        .setDescription('Search for books by title, author, or general query.')
        .addStringOption(option =>
          option
            .setName('query')
            .setDescription('What book do you want to search for? (title, author, etc.)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('isbn')
        .setDescription('Search for a book by ISBN.')
        .addStringOption(option =>
          option
            .setName('isbn')
            .setDescription('Enter the ISBN (10 or 13 digits)')
            .setRequired(true)
        )
    ),

  /**
   * Executes the book search command.
   * This function:
   * 1. Validates the search query
   * 2. Performs search based on subcommand
   * 3. Displays results with pagination
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error during command execution
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      await interaction.deferReply();
      const subcommand = interaction.options.getSubcommand();
      
      logger.info(`/book ${subcommand} command initiated:`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand: subcommand
      });

      let results;
      switch (subcommand) {
        case 'search':
          const query = interaction.options.getString('query');
          results = await this.searchBooks(query, 10);
          break;
        case 'isbn':
          const isbn = interaction.options.getString('isbn');
          results = await this.searchByISBN(isbn);
          break;
      }

      if (!results || results.length === 0) {
        return await interaction.editReply({
          content: "⚠️ No books found for your search.",
          ephemeral: true
        });
      }

      const generateEmbed = (index) => this.createBookEmbed(results, index);

      await createPaginatedResults(
        interaction,
        results,
        generateEmbed,
        'book',
        120000,
        logger,
        {
          buttonStyle: ButtonStyle.Primary,
          prevLabel: "Previous",
          nextLabel: "Next",
          prevEmoji: "◀️",
          nextEmoji: "▶️"
        }
      );

      logger.info(`/book ${subcommand} command completed successfully:`, {
        userId: interaction.user.id,
        subcommand: subcommand,
        query: subcommand === 'search' ? interaction.options.getString('query') : interaction.options.getString('isbn'),
        resultCount: results.length
      });

    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Searches for books using the Google Books API.
   * 
   * @param {string} query - The search query
   * @param {number} maxResults - Maximum number of results to return
   * @returns {Promise<Array|null>} Array of book results or null if no results
   */
  async searchBooks(query, maxResults = 10) {
    try {
      const apiKey = config.googleBooksApiKey;
      if (!apiKey) {
        logger.error("Google Books API key is not configured");
        throw new Error("API_KEY_MISSING");
      }

      const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
        params: {
          q: query,
          maxResults: maxResults,
          orderBy: 'relevance',
          printType: 'books',
          fields: 'items(id,volumeInfo,searchInfo)',
          key: apiKey
        },
        timeout: 10000
      });

      if (!response.data.items || response.data.items.length === 0) {
        return null;
      }

      const books = response.data.items.map((item, index) => ({
        index,
        id: item.id,
        title: item.volumeInfo.title || 'Unknown Title',
        authors: item.volumeInfo.authors || ['Unknown Author'],
        description: item.volumeInfo.description || item.searchInfo?.textSnippet || 'No description available',
        publishedDate: item.volumeInfo.publishedDate || 'Unknown',
        pageCount: item.volumeInfo.pageCount || 'Unknown',
        categories: item.volumeInfo.categories || [],
        averageRating: item.volumeInfo.averageRating || null,
        ratingsCount: item.volumeInfo.ratingsCount || 0,
        language: item.volumeInfo.language || 'Unknown',
        publisher: item.volumeInfo.publisher || 'Unknown',
        isbn10: this.extractISBN(item.volumeInfo.industryIdentifiers, 'ISBN_10'),
        isbn13: this.extractISBN(item.volumeInfo.industryIdentifiers, 'ISBN_13'),
        imageUrl: item.volumeInfo.imageLinks?.thumbnail || null,
        previewLink: item.volumeInfo.previewLink || null,
        infoLink: item.volumeInfo.infoLink || null,
        maturityRating: item.volumeInfo.maturityRating || 'NOT_MATURE'
      }));

      return books;
    } catch (error) {
      logger.error("Failed to search for books:", {
        error: error.message,
        query
      });
      return null;
    }
  },

  /**
   * Searches for a book by ISBN using the Google Books API.
   * 
   * @param {string} isbn - The ISBN to search for
   * @returns {Promise<Array|null>} Array with single book result or null if not found
   */
  async searchByISBN(isbn) {
    try {
      const apiKey = config.googleBooksApiKey;
      if (!apiKey) {
        logger.error("Google Books API key is not configured");
        throw new Error("API_KEY_MISSING");
      }

      // Clean the ISBN (remove hyphens and spaces)
      const cleanISBN = isbn.replace(/[-\s]/g, '');
      
      const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
        params: {
          q: `isbn:${cleanISBN}`,
          maxResults: 1,
          fields: 'items(id,volumeInfo,searchInfo)',
          key: apiKey
        },
        timeout: 10000
      });

      if (!response.data.items || response.data.items.length === 0) {
        return null;
      }

      const item = response.data.items[0];
      const book = {
        index: 0,
        id: item.id,
        title: item.volumeInfo.title || 'Unknown Title',
        authors: item.volumeInfo.authors || ['Unknown Author'],
        description: item.volumeInfo.description || item.searchInfo?.textSnippet || 'No description available',
        publishedDate: item.volumeInfo.publishedDate || 'Unknown',
        pageCount: item.volumeInfo.pageCount || 'Unknown',
        categories: item.volumeInfo.categories || [],
        averageRating: item.volumeInfo.averageRating || null,
        ratingsCount: item.volumeInfo.ratingsCount || 0,
        language: item.volumeInfo.language || 'Unknown',
        publisher: item.volumeInfo.publisher || 'Unknown',
        isbn10: this.extractISBN(item.volumeInfo.industryIdentifiers, 'ISBN_10'),
        isbn13: this.extractISBN(item.volumeInfo.industryIdentifiers, 'ISBN_13'),
        imageUrl: item.volumeInfo.imageLinks?.thumbnail || null,
        previewLink: item.volumeInfo.previewLink || null,
        infoLink: item.volumeInfo.infoLink || null,
        maturityRating: item.volumeInfo.maturityRating || 'NOT_MATURE'
      };

      return [book];
    } catch (error) {
      logger.error("Failed to search for book by ISBN:", {
        error: error.message,
        isbn
      });
      return null;
    }
  },

  /**
   * Extracts ISBN from industry identifiers array.
   * 
   * @param {Array} identifiers - Array of industry identifiers
   * @param {string} type - Type of ISBN to extract ('ISBN_10' or 'ISBN_13')
   * @returns {string|null} The ISBN or null if not found
   */
  extractISBN(identifiers, type) {
    if (!identifiers) return null;
    const identifier = identifiers.find(id => id.type === type);
    return identifier ? identifier.identifier : null;
  },

  /**
   * Creates a Discord embed with book information.
   * 
   * @param {Array} books - Array of book objects
   * @param {number} index - Index of the book to display
   * @returns {EmbedBuilder} Discord embed with book details
   */
  createBookEmbed(books, index = 0) {
    const book = books[index];
    
    if (!book) {
      throw new Error("No book data available");
    }

    const embed = new EmbedBuilder()
      .setColor(0xBA93FA)
      .setTitle(`📚 ${book.title}`)
      .setDescription(this.truncateDescription(book.description))
      .setFooter({ 
        text: `Book ${index + 1} of ${books.length} • Powered by Google Books`
      });

    // Add authors
    if (book.authors && book.authors.length > 0) {
      embed.addFields({
        name: '👤 Authors',
        value: book.authors.join(', '),
        inline: false
      });
    }

    // Add basic info
    const basicFields = [];
    if (book.publishedDate !== 'Unknown') {
      basicFields.push({ name: '📅 Published', value: book.publishedDate, inline: true });
    }
    if (book.pageCount !== 'Unknown') {
      basicFields.push({ name: '📄 Pages', value: book.pageCount.toString(), inline: true });
    }
    if (book.language !== 'Unknown') {
      basicFields.push({ name: '🌐 Language', value: book.language.toUpperCase(), inline: true });
    }
    if (book.publisher !== 'Unknown') {
      basicFields.push({ name: '🏢 Publisher', value: book.publisher, inline: true });
    }

    if (basicFields.length > 0) {
      embed.addFields(basicFields);
    }

    // Add rating if available
    if (book.averageRating) {
      const stars = '⭐'.repeat(Math.round(book.averageRating));
      embed.addFields({
        name: '⭐ Rating',
        value: `${stars} ${book.averageRating}/5 (${this.formatNumber(book.ratingsCount)} ratings)`,
        inline: true
      });
    }

    // Add categories if available
    if (book.categories && book.categories.length > 0) {
      embed.addFields({
        name: '📂 Categories',
        value: book.categories.join(', '),
        inline: false
      });
    }

    // Add ISBNs if available
    const isbnFields = [];
    if (book.isbn10) {
      isbnFields.push({ name: '📖 ISBN-10', value: book.isbn10, inline: true });
    }
    if (book.isbn13) {
      isbnFields.push({ name: '📖 ISBN-13', value: book.isbn13, inline: true });
    }
    if (isbnFields.length > 0) {
      embed.addFields(isbnFields);
    }

    // Add links if available
    const links = [];
    if (book.previewLink) {
      links.push(`[Preview](${book.previewLink})`);
    }
    if (book.infoLink) {
      links.push(`[More Info](${book.infoLink})`);
    }
    if (links.length > 0) {
      embed.addFields({
        name: '🔗 Links',
        value: links.join(' • '),
        inline: false
      });
    }

    // Set thumbnail if available
    if (book.imageUrl) {
      embed.setThumbnail(book.imageUrl);
    }

    // Set URL if available
    if (book.infoLink) {
      embed.setURL(book.infoLink);
    }

    return embed;
  },

  /**
   * Truncates description text to fit Discord embed limits.
   * 
   * @param {string} description - The description text
   * @param {number} maxLength - Maximum length (default: 2000)
   * @returns {string} Truncated description
   */
  truncateDescription(description, maxLength = 2000) {
    if (!description) return 'No description available';
    if (description.length <= maxLength) return description;
    return description.substring(0, maxLength - 3) + '...';
  },

  /**
   * Formats a number with commas for better readability.
   * 
   * @param {number} num - The number to format
   * @returns {string} Formatted number
   */
  formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
    logger.error("Error in book command:", {
      error: error.message,
      stack: error.stack,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = "⚠️ An unexpected error occurred while searching for books.";
    
    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to search Google Books. Please try again later.";
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = "⚠️ Google Books API rate limit reached. Please try again in a few moments.";
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
    } else if (error.message === "NO_RESULTS") {
      errorMessage = "⚠️ No books found for your search.";
    } else if (error.message === "INVALID_ISBN") {
      errorMessage = "⚠️ Please provide a valid ISBN (10 or 13 digits).";
    } else if (error.message === "INVALID_QUERY") {
      errorMessage = "⚠️ Please provide a valid search query.";
    } else if (error.message === "API_KEY_MISSING") {
      errorMessage = "⚠️ Google Books API is not properly configured. Please contact an administrator.";
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for book command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {});
    }
  }
}; 