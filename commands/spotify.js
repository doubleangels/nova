/**
 * Spotify command module for searching and displaying music information.
 * Handles API interactions with Spotify and result formatting.
 * @module commands/spotify
 */

const { SlashCommandBuilder, EmbedBuilder, ButtonStyle } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { logError } = require('../errors');
const { createPaginatedResults } = require('../utils/searchUtils');

const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';
const SPOTIFY_REQUEST_TIMEOUT = 10000;

const SPOTIFY_SEARCH_MAX_RESULTS = 10;
const SPOTIFY_COLLECTOR_TIMEOUT_MS = 120000;

const SPOTIFY_EMBED_COLOR = 0x1DB954;
const SPOTIFY_EMBED_FOOTER = "Powered by Spotify";
const SPOTIFY_EMBED_PREV_LABEL = "Previous";
const SPOTIFY_EMBED_NEXT_LABEL = "Next";
const SPOTIFY_EMBED_PREV_EMOJI = "◀️";
const SPOTIFY_EMBED_NEXT_EMOJI = "▶️";

const SPOTIFY_ERROR_CONFIG_MISSING = "⚠️ This command is not properly configured. Please contact an administrator.";
const SPOTIFY_ERROR_UNEXPECTED = "⚠️ An unexpected error occurred while searching Spotify.";
const SPOTIFY_ERROR_API = "⚠️ Failed to search Spotify. Please try again later.";
const SPOTIFY_ERROR_RATE_LIMIT = "⚠️ Spotify API rate limit reached. Please try again in a few moments.";
const SPOTIFY_ERROR_NETWORK = "⚠️ Network error occurred. Please check your internet connection.";
const SPOTIFY_ERROR_ACCESS_DENIED = "⚠️ Spotify API access denied. Please check API configuration.";
const SPOTIFY_ERROR_NO_RESULTS = "⚠️ No results found for your search.";
const SPOTIFY_ERROR_INVALID_TRACK = "⚠️ Invalid track specified.";
const SPOTIFY_ERROR_AUTH = "⚠️ Failed to authenticate with Spotify.";

/**
 * We handle the /spotify command.
 * This function allows users to search for music, albums, artists, playlists, and podcasts on Spotify.
 *
 * We perform several tasks:
 * 1. We validate Spotify API configuration.
 * 2. We process search requests for different Spotify entities.
 * 3. We format and display paginated search results.
 * 4. We handle errors and provide user feedback.
 *
 * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('spotify')
    .setDescription('Search for music on Spotify.')
    .addSubcommand(subcommand =>
      subcommand
        .setName('song')
        .setDescription('Search for a song.')
        .addStringOption(option =>
          option
            .setName('query')
            .setDescription('What song do you want to search for?')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('album')
        .setDescription('Search for an album on Spotify.')
        .addStringOption(option =>
          option
            .setName('query')
            .setDescription('What album do you want to search for?')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('artist')
        .setDescription('Search for an artist on Spotify.')
        .addStringOption(option =>
          option
            .setName('query')
            .setDescription('What artist do you want to search for?')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('playlist')
        .setDescription('Search for a playlist on Spotify.')
        .addStringOption(option =>
          option
            .setName('query')
            .setDescription('What playlist do you want to search for?')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('podcast')
        .setDescription('Search for a podcast on Spotify.')
        .addStringOption(option =>
          option
            .setName('query')
            .setDescription('What podcast do you want to search for?')
            .setRequired(true)
        )
    ),

  /**
   * Executes the Spotify search command.
   * @async
   * @function execute
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @throws {Error} If the command execution fails
   */
  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: SPOTIFY_ERROR_CONFIG_MISSING,
          ephemeral: true
        });
      }

      await interaction.deferReply();
      logger.info(`/spotify command initiated:`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand: interaction.options.getSubcommand()
      });

      const subcommand = interaction.options.getSubcommand();

      const accessToken = await this.getSpotifyAccessToken();
      if (!accessToken) {
        return await interaction.editReply({
          content: SPOTIFY_ERROR_ACCESS_DENIED,
          ephemeral: true
        });
      }

      let results;
      switch (subcommand) {
        case 'song':
          results = await this.searchSong(interaction.options.getString('query'), accessToken);
          break;
        case 'album':
          results = await this.searchAlbum(interaction.options.getString('query'), accessToken);
          break;
        case 'artist':
          results = await this.searchArtist(interaction.options.getString('query'), accessToken);
          break;
        case 'playlist':
          results = await this.searchPlaylist(interaction.options.getString('query'), accessToken);
          break;
        case 'podcast':
          results = await this.searchPodcast(interaction.options.getString('query'), accessToken);
          break;
      }

      if (!results || results.length === 0) {
        return await interaction.editReply({
          content: SPOTIFY_ERROR_NO_RESULTS,
          ephemeral: true
        });
      }

      const generateEmbed = (index) => this.createEmbed(results, subcommand, index);

      await createPaginatedResults(
        interaction,
        results,
        generateEmbed,
        'spotify',
        SPOTIFY_COLLECTOR_TIMEOUT_MS,
        logger,
        {
          buttonStyle: ButtonStyle.Secondary,
          prevLabel: SPOTIFY_EMBED_PREV_LABEL,
          nextLabel: SPOTIFY_EMBED_NEXT_LABEL,
          prevEmoji: SPOTIFY_EMBED_PREV_EMOJI,
          nextEmoji: SPOTIFY_EMBED_NEXT_EMOJI
        }
      );

    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Validates that the required API configuration is available.
   * @function validateConfiguration
   * @returns {boolean} True if configuration is valid, false otherwise
   */
  validateConfiguration() {
    if (!config.spotifyClientId || !config.spotifyClientSecret) {
      logger.error("Spotify API configuration is missing:", {
        hasClientId: !!config.spotifyClientId,
        hasClientSecret: !!config.spotifyClientSecret
      });
      return false;
    }
    return true;
  },

  /**
   * Gets a Spotify access token using client credentials.
   * @async
   * @function getSpotifyAccessToken
   * @returns {Promise<string|null>} The access token or null if failed
   */
  async getSpotifyAccessToken() {
    try {
      const response = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'client_credentials'
        }),
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(
              `${config.spotifyClientId}:${config.spotifyClientSecret}`
            ).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: SPOTIFY_REQUEST_TIMEOUT
        }
      );

      return response.data.access_token;
    } catch (error) {
      logger.error("Failed to get Spotify access token:", {
        error: error.message
      });
      return null;
    }
  },

  /**
   * Searches for a song on Spotify.
   * @async
   * @function searchSong
   * @param {string} query - The search query
   * @param {string} accessToken - The Spotify access token
   * @returns {Promise<Object|null>} The song data or null if not found
   */
  async searchSong(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'track',
          limit: SPOTIFY_SEARCH_MAX_RESULTS
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: SPOTIFY_REQUEST_TIMEOUT
      });

      if (!response.data.tracks.items.length) {
        return null;
      }

      const tracks = response.data.tracks.items.map((track, index) => ({
        index,
        type: 'song',
        name: track.name,
        artists: track.artists.map(artist => artist.name).join(', '),
        album: track.album.name,
        albumUrl: track.album.external_urls.spotify,
        url: track.external_urls.spotify,
        imageUrl: track.album.images[0]?.url,
        duration: this.formatDuration(track.duration_ms),
        popularity: track.popularity,
        releaseDate: track.album.release_date,
        trackNumber: track.track_number,
        totalTracks: track.album.total_tracks,
        explicit: track.explicit,
        discNumber: track.disc_number,
        isrc: track.external_ids?.isrc
      }));

      return tracks;
    } catch (error) {
      logger.error("Failed to search for song:", {
        error: error.message,
        query
      });
      return null;
    }
  },

  /**
   * Searches for an album on Spotify.
   * @async
   * @function searchAlbum
   * @param {string} query - The search query
   * @param {string} accessToken - The Spotify access token
   * @returns {Promise<Object|null>} The album data or null if not found
   */
  async searchAlbum(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'album',
          limit: SPOTIFY_SEARCH_MAX_RESULTS
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: SPOTIFY_REQUEST_TIMEOUT
      });

      if (!response.data.albums.items.length) {
        return null;
      }

      const albums = response.data.albums.items.map((album, index) => ({
        index,
        type: 'album',
        name: album.name,
        artists: album.artists.map(artist => artist.name).join(', '),
        url: album.external_urls.spotify,
        imageUrl: album.images[0]?.url,
        releaseDate: album.release_date,
        totalTracks: album.total_tracks,
        albumType: album.album_type,
        label: album.label,
        copyrights: album.copyrights,
        availableMarkets: album.available_markets
      }));

      return albums;
    } catch (error) {
      logger.error("Failed to search for album:", {
        error: error.message,
        query
      });
      return null;
    }
  },

  /**
   * Searches for an artist on Spotify.
   * @async
   * @function searchArtist
   * @param {string} query - The search query
   * @param {string} accessToken - The Spotify access token
   * @returns {Promise<Object|null>} The artist data or null if not found
   */
  async searchArtist(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'artist',
          limit: SPOTIFY_SEARCH_MAX_RESULTS
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: SPOTIFY_REQUEST_TIMEOUT
      });

      if (!response.data.artists.items.length) {
        return null;
      }

      const artists = response.data.artists.items.map((artist, index) => ({
        index,
        type: 'artist',
        name: artist.name,
        url: artist.external_urls.spotify,
        imageUrl: artist.images[0]?.url,
        followers: artist.followers.total,
        popularity: artist.popularity,
        genres: artist.genres,
        topTracks: artist.top_tracks?.tracks.map(track => ({
          name: track.name,
          url: track.external_urls.spotify
        }))
      }));

      return artists;
    } catch (error) {
      logger.error("Failed to search for artist:", {
        error: error.message,
        query
      });
      return null;
    }
  },

  /**
   * Searches for a playlist on Spotify.
   * @async
   * @function searchPlaylist
   * @param {string} query - The search query
   * @param {string} accessToken - The Spotify access token
   * @returns {Promise<Object|null>} The playlist data or null if not found
   */
  async searchPlaylist(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'playlist',
          limit: SPOTIFY_SEARCH_MAX_RESULTS
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: SPOTIFY_REQUEST_TIMEOUT
      });

      if (!response.data.playlists.items.length) {
        return null;
      }

      const playlists = response.data.playlists.items.map((playlist, index) => ({
        index,
        type: 'playlist',
        name: playlist.name,
        owner: playlist.owner.display_name,
        ownerUrl: playlist.owner.external_urls.spotify,
        url: playlist.external_urls.spotify,
        imageUrl: playlist.images[0]?.url,
        tracks: playlist.tracks.total,
        description: playlist.description,
        followers: playlist.followers.total,
        lastUpdated: new Date(playlist.modified_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }),
        collaborative: playlist.collaborative,
        public: playlist.public,
        snapshotId: playlist.snapshot_id
      }));

      return playlists;
    } catch (error) {
      logger.error("Failed to search for playlist:", {
        error: error.message,
        query
      });
      return null;
    }
  },

  /**
   * Searches for a podcast on Spotify.
   * @async
   * @function searchPodcast
   * @param {string} query - The search query
   * @param {string} accessToken - The Spotify access token
   * @returns {Promise<Object|null>} The podcast data or null if not found
   */
  async searchPodcast(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'show',
          limit: SPOTIFY_SEARCH_MAX_RESULTS
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: SPOTIFY_REQUEST_TIMEOUT
      });

      if (!response.data.shows.items.length) {
        return null;
      }

      const shows = response.data.shows.items.map((show, index) => ({
        index,
        type: 'podcast',
        name: show.name,
        publisher: show.publisher,
        url: show.external_urls.spotify,
        imageUrl: show.images[0]?.url,
        description: show.description,
        totalEpisodes: show.total_episodes,
        languages: show.languages.join(', '),
        explicit: show.explicit,
        copyrights: show.copyrights,
        availableMarkets: show.available_markets,
        episodes: show.episodes.items.map(episode => ({
          name: episode.name,
          duration: this.formatDuration(episode.duration_ms),
          releaseDate: episode.release_date,
          url: episode.external_urls.spotify
        }))
      }));

      return shows;
    } catch (error) {
      logger.error("Failed to search for podcast:", {
        error: error.message,
        query
      });
      return null;
    }
  },

  /**
   * Creates an embed for the search result.
   * @function createEmbed
   * @param {Array} results - The array of search results
   * @param {string} type - The type of result (song, album, artist, playlist, podcast)
   * @param {number} index - The index of the result to display
   * @returns {import('discord.js').EmbedBuilder} The formatted embed
   */
  createEmbed(results, type, index = 0) {
    const item = results[index];
    
    if (!item) {
      throw new Error("No result data available");
    }

    const embed = new EmbedBuilder()
      .setColor(SPOTIFY_EMBED_COLOR)
      .setTitle(item.name)
      .setURL(item.url)
      .setThumbnail(item.imageUrl)
      .setFooter({ 
        text: `${SPOTIFY_EMBED_PREV_LABEL} ${index + 1} of ${results.length} • ${SPOTIFY_EMBED_FOOTER}`
      });

    switch (type) {
      case 'song':
        embed
          .setDescription(`🎵 ${item.artists}`)
          .addFields(
            { name: 'Album', value: `[${item.album}](${item.albumUrl})`, inline: true },
            { name: 'Duration', value: item.duration, inline: true },
            { name: 'Popularity', value: `${item.popularity}%`, inline: true },
            { name: 'Release Date', value: item.releaseDate || 'Unknown', inline: true },
            { name: 'Track Number', value: item.trackNumber ? `${item.trackNumber}/${item.totalTracks}` : 'Unknown', inline: true },
            { name: 'Explicit', value: item.explicit ? 'Yes' : 'No', inline: true },
            { name: 'Disc Number', value: item.discNumber?.toString() || 'Unknown', inline: true },
            { name: 'ISRC', value: item.isrc || 'Unknown', inline: true }
          );
        break;

      case 'album':
        embed
          .setDescription(`👤 ${item.artists}`)
          .addFields(
            { name: 'Release Date', value: item.releaseDate, inline: true },
            { name: 'Tracks', value: item.totalTracks.toString(), inline: true },
            { name: 'Album Type', value: item.albumType || 'Unknown', inline: true },
            { name: 'Label', value: item.label || 'Unknown', inline: true },
            { name: 'Copyright', value: item.copyrights?.map(c => c.text).join('\n') || 'Unknown', inline: false },
            { name: 'Available Markets', value: item.availableMarkets?.length ? `${item.availableMarkets.length} markets` : 'Unknown', inline: true }
          );
        break;

      case 'artist':
        embed
          .addFields(
            { name: 'Followers', value: this.formatNumber(item.followers), inline: true },
            { name: 'Popularity', value: `${item.popularity}%`, inline: true },
            { name: 'Genres', value: item.genres?.join(', ') || 'No genres listed', inline: false },
            { name: 'Top Tracks', value: item.topTracks?.map(track => `[${track.name}](${track.url})`).join('\n') || 'No top tracks available', inline: false }
          );
        break;

      case 'playlist':
        embed
          .setDescription(item.description || 'No description available')
          .addFields(
            { name: 'Created by', value: `[${item.owner}](${item.ownerUrl})`, inline: true },
            { name: 'Tracks', value: item.tracks.toString(), inline: true },
            { name: 'Followers', value: this.formatNumber(item.followers) || 'Unknown', inline: true },
            { name: 'Last Updated', value: item.lastUpdated || 'Unknown', inline: true },
            { name: 'Collaborative', value: item.collaborative ? 'Yes' : 'No', inline: true },
            { name: 'Public', value: item.public ? 'Yes' : 'No', inline: true },
            { name: 'Snapshot ID', value: item.snapshotId || 'Unknown', inline: true }
          );
        break;

      case 'podcast':
        embed
          .setDescription(item.description)
          .addFields(
            { name: 'Publisher', value: item.publisher, inline: true },
            { name: 'Total Episodes', value: item.totalEpisodes.toString(), inline: true },
            { name: 'Languages', value: item.languages, inline: true },
            { name: 'Explicit', value: item.explicit ? 'Yes' : 'No', inline: true },
            { name: 'Copyright', value: item.copyrights?.map(c => c.text).join('\n') || 'Unknown', inline: false },
            { name: 'Available Markets', value: item.availableMarkets?.length ? `${item.availableMarkets.length} markets` : 'Unknown', inline: true },
            { 
              name: 'Latest Episodes', 
              value: item.episodes.slice(0, 5).map(episode => 
                `[${episode.name}](${episode.url}) - ${episode.duration} (${episode.releaseDate})`
              ).join('\n'),
              inline: false 
            }
          );
        break;
    }

    return embed;
  },

  /**
   * Formats milliseconds into a readable duration string.
   * @function formatDuration
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration string
   */
  formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  },

  /**
   * Formats a number with commas for readability.
   * @function formatNumber
   * @param {number} num - The number to format
   * @returns {string} Formatted number string
   */
  formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  },

  /**
   * Handles errors that occur during command execution.
   * @async
   * @function handleError
   * @param {import('discord.js').ChatInputCommandInteraction} interaction - The interaction object
   * @param {Error} error - The error that occurred
   */
  async handleError(interaction, error) {
    logError(error, 'spotify', {
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });
    
    let errorMessage = SPOTIFY_ERROR_UNEXPECTED;
    
    if (error.message === "API_ERROR") {
      errorMessage = SPOTIFY_ERROR_API;
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = SPOTIFY_ERROR_RATE_LIMIT;
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = SPOTIFY_ERROR_NETWORK;
    } else if (error.message === "NO_RESULTS") {
      errorMessage = SPOTIFY_ERROR_NO_RESULTS;
    } else if (error.message === "INVALID_TRACK") {
      errorMessage = SPOTIFY_ERROR_INVALID_TRACK;
    } else if (error.message === "AUTH_ERROR") {
      errorMessage = SPOTIFY_ERROR_AUTH;
    }
    
    try {
      await interaction.editReply({ 
        content: errorMessage,
        ephemeral: true 
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for spotify command:", {
        error: followUpError.message,
        originalError: error.message,
        userId: interaction.user?.id
      });
      
      await interaction.reply({ 
        content: errorMessage,
        ephemeral: true 
      }).catch(() => {
      });
    }
  }
}; 