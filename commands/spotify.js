const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const path = require('path');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');

// Configuration constants for Spotify integration
const SPOTIFY_API_BASE_URL = 'https://api.spotify.com/v1';
const SPOTIFY_EMBED_COLOR = 0x1DB954; // Spotify's brand color
const REQUEST_TIMEOUT = 10000; // 10 second timeout for API requests

module.exports = {
  data: new SlashCommandBuilder()
    .setName('spotify')
    .setDescription('Search for music on Spotify')
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
        .setDescription('Search for an album.')
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
        .setDescription('Search for an artist.')
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
        .setDescription('Search for a playlist.')
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
        .setDescription('Search for a podcast.')
        .addStringOption(option =>
          option
            .setName('query')
            .setDescription('What podcast do you want to search for?')
            .setRequired(true)
        )
    ),

  /**
   * Executes the spotify command.
   * @param {ChatInputCommandInteraction} interaction - The Discord interaction object.
   */
  async execute(interaction) {
    try {
      // Validate Spotify API configuration
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact a server administrator.",
          ephemeral: true
        });
      }

      // Defer the reply to allow time for API requests
      await interaction.deferReply();
      logger.info(`/spotify command initiated.`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand: interaction.options.getSubcommand()
      });

      const subcommand = interaction.options.getSubcommand();

      // Get access token for Spotify API
      const accessToken = await this.getSpotifyAccessToken();
      if (!accessToken) {
        return await interaction.editReply({
          content: "⚠️ Failed to authenticate with Spotify. Please try again later.",
          ephemeral: true
        });
      }

      // Process the search based on subcommand
      let result;
      switch (subcommand) {
        case 'song':
          result = await this.searchSong(interaction.options.getString('query'), accessToken);
          break;
        case 'album':
          result = await this.searchAlbum(interaction.options.getString('query'), accessToken);
          break;
        case 'artist':
          result = await this.searchArtist(interaction.options.getString('query'), accessToken);
          break;
        case 'playlist':
          result = await this.searchPlaylist(interaction.options.getString('query'), accessToken);
          break;
        case 'podcast':
          result = await this.searchPodcast(interaction.options.getString('query'), accessToken);
          break;
      }

      if (!result) {
        return await interaction.editReply({
          content: `⚠️ No results found for "${interaction.options.getString('query')}"`,
          ephemeral: true
        });
      }

      // Create and send the embed
      const embed = this.createEmbed(result, subcommand);
      await interaction.editReply({ embeds: [embed] });

    } catch (error) {
      logger.error("Error executing /spotify command.", {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
      await interaction.editReply({
        content: "⚠️ An unexpected error occurred. Please try again later.",
        ephemeral: true
      });
    }
  },

  /**
   * Validates that the required API configuration is available.
   * @returns {boolean} True if configuration is valid, false otherwise.
   */
  validateConfiguration() {
    if (!config.spotifyClientId || !config.spotifyClientSecret) {
      logger.error("Spotify API configuration is missing.", {
        hasClientId: !!config.spotifyClientId,
        hasClientSecret: !!config.spotifyClientSecret
      });
      return false;
    }
    return true;
  },

  /**
   * Gets a Spotify access token using client credentials.
   * @returns {Promise<string|null>} The access token or null if failed.
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
          timeout: REQUEST_TIMEOUT
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
   * @param {string} query - The search query.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The song data or null if not found.
   */
  async searchSong(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'track',
          limit: 1
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!response.data.tracks.items.length) {
        return null;
      }

      const track = response.data.tracks.items[0];
      
      // Get additional track details
      const trackDetails = await axios.get(`${SPOTIFY_API_BASE_URL}/tracks/${track.id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      return {
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
        isrc: track.external_ids?.isrc,
        previewUrl: track.preview_url
      };
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
   * @param {string} query - The search query.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The album data or null if not found.
   */
  async searchAlbum(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'album',
          limit: 1
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!response.data.albums.items.length) {
        return null;
      }

      const album = response.data.albums.items[0];
      
      // Get additional album details
      const albumDetails = await axios.get(`${SPOTIFY_API_BASE_URL}/albums/${album.id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      return {
        type: 'album',
        name: album.name,
        artists: album.artists.map(artist => artist.name).join(', '),
        url: album.external_urls.spotify,
        imageUrl: album.images[0]?.url,
        releaseDate: album.release_date,
        totalTracks: album.total_tracks,
        albumType: album.album_type,
        label: albumDetails.data.label,
        copyrights: albumDetails.data.copyrights,
        availableMarkets: albumDetails.data.available_markets,
        externalIds: albumDetails.data.external_ids
      };
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
   * @param {string} query - The search query.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The artist data or null if not found.
   */
  async searchArtist(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'artist',
          limit: 1
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!response.data.artists.items.length) {
        return null;
      }

      const artist = response.data.artists.items[0];
      
      // Get artist's top tracks
      const topTracksResponse = await axios.get(
        `${SPOTIFY_API_BASE_URL}/artists/${artist.id}/top-tracks?market=US`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          timeout: REQUEST_TIMEOUT
        }
      );

      return {
        type: 'artist',
        name: artist.name,
        url: artist.external_urls.spotify,
        imageUrl: artist.images[0]?.url,
        followers: artist.followers.total,
        popularity: artist.popularity,
        genres: artist.genres,
        topTracks: topTracksResponse.data.tracks.map(track => ({
          name: track.name,
          url: track.external_urls.spotify
        })),
        externalUrls: artist.external_urls
      };
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
   * @param {string} query - The search query.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The playlist data or null if not found.
   */
  async searchPlaylist(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'playlist',
          limit: 1
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!response.data.playlists.items.length) {
        return null;
      }

      const playlist = response.data.playlists.items[0];
      
      // Get additional playlist details
      const playlistDetails = await axios.get(`${SPOTIFY_API_BASE_URL}/playlists/${playlist.id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      // Format the last modified date
      const lastModified = new Date(playlistDetails.data.modified_at);
      const formattedDate = lastModified.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      return {
        type: 'playlist',
        name: playlist.name,
        owner: playlist.owner.display_name,
        ownerUrl: playlist.owner.external_urls.spotify,
        url: playlist.external_urls.spotify,
        imageUrl: playlist.images[0]?.url,
        tracks: playlist.tracks.total,
        description: playlist.description,
        followers: playlistDetails.data.followers.total,
        lastUpdated: formattedDate,
        collaborative: playlistDetails.data.collaborative,
        public: playlistDetails.data.public,
        snapshotId: playlistDetails.data.snapshot_id,
        externalUrls: playlistDetails.data.external_urls
      };
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
   * @param {string} query - The search query.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The podcast data or null if not found.
   */
  async searchPodcast(query, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: query,
          type: 'show',
          limit: 1
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!response.data.shows.items.length) {
        return null;
      }

      const show = response.data.shows.items[0];

      // Get show details
      const showDetails = await axios.get(`${SPOTIFY_API_BASE_URL}/shows/${show.id}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      return {
        type: 'podcast',
        name: show.name,
        publisher: show.publisher,
        url: show.external_urls.spotify,
        imageUrl: show.images[0]?.url,
        description: show.description,
        totalEpisodes: show.total_episodes,
        languages: show.languages.join(', '),
        explicit: show.explicit,
        mediaType: show.media_type,
        copyrights: showDetails.data.copyrights,
        availableMarkets: showDetails.data.available_markets,
        episodes: showDetails.data.episodes.items.map(episode => ({
          name: episode.name,
          duration: this.formatDuration(episode.duration_ms),
          releaseDate: episode.release_date,
          url: episode.external_urls.spotify
        }))
      };
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
   * @param {Object} result - The search result data.
   * @param {string} type - The type of result (song, album, artist, playlist).
   * @returns {EmbedBuilder} The formatted embed.
   */
  createEmbed(result, type) {
    const embed = new EmbedBuilder()
      .setColor(SPOTIFY_EMBED_COLOR)
      .setTitle(result.name)
      .setURL(result.url)
      .setThumbnail(result.imageUrl)
      .setFooter({ text: 'Powered by Spotify API' });

    switch (type) {
      case 'song':
        embed
          .setDescription(`🎵 ${result.artists}`)
          .addFields(
            { name: 'Album', value: `[${result.album}](${result.albumUrl})`, inline: true },
            { name: 'Duration', value: result.duration, inline: true },
            { name: 'Popularity', value: `${result.popularity}%`, inline: true },
            { name: 'Release Date', value: result.releaseDate || 'Unknown', inline: true },
            { name: 'Track Number', value: result.trackNumber ? `${result.trackNumber}/${result.totalTracks}` : 'Unknown', inline: true },
            { name: 'Explicit', value: result.explicit ? 'Yes' : 'No', inline: true },
            { name: 'Disc Number', value: result.discNumber?.toString() || 'Unknown', inline: true },
            { name: 'ISRC', value: result.isrc || 'Unknown', inline: true },
            { name: 'Preview', value: result.previewUrl ? `[Listen](${result.previewUrl})` : 'Not available', inline: true }
          );
        break;

      case 'album':
        embed
          .setDescription(`👤 ${result.artists}`)
          .addFields(
            { name: 'Release Date', value: result.releaseDate, inline: true },
            { name: 'Tracks', value: result.totalTracks.toString(), inline: true },
            { name: 'Album Type', value: result.albumType || 'Unknown', inline: true },
            { name: 'Label', value: result.label || 'Unknown', inline: true },
            { name: 'Copyright', value: result.copyrights?.map(c => c.text).join('\n') || 'Unknown', inline: false },
            { name: 'Available Markets', value: result.availableMarkets?.length ? `${result.availableMarkets.length} markets` : 'Unknown', inline: true },
            { name: 'External IDs', value: result.externalIds ? Object.entries(result.externalIds).map(([key, value]) => `${key}: ${value}`).join('\n') : 'None', inline: false }
          );
        break;

      case 'artist':
        embed
          .addFields(
            { name: 'Followers', value: this.formatNumber(result.followers), inline: true },
            { name: 'Popularity', value: `${result.popularity}%`, inline: true },
            { name: 'Genres', value: result.genres?.join(', ') || 'No genres listed', inline: false },
            { name: 'Top Tracks', value: result.topTracks?.map(track => `[${track.name}](${track.url})`).join('\n') || 'No top tracks available', inline: false },
            { name: 'External URLs', value: Object.entries(result.externalUrls || {}).map(([key, value]) => `[${key}](${value})`).join(' • ') || 'None', inline: false }
          );
        break;

      case 'playlist':
        embed
          .setDescription(result.description || 'No description available')
          .addFields(
            { name: 'Created by', value: `[${result.owner}](${result.ownerUrl})`, inline: true },
            { name: 'Tracks', value: result.tracks.toString(), inline: true },
            { name: 'Followers', value: this.formatNumber(result.followers) || 'Unknown', inline: true },
            { name: 'Last Updated', value: result.lastUpdated || 'Unknown', inline: true },
            { name: 'Collaborative', value: result.collaborative ? 'Yes' : 'No', inline: true },
            { name: 'Public', value: result.public ? 'Yes' : 'No', inline: true },
            { name: 'Snapshot ID', value: result.snapshotId || 'Unknown', inline: true },
            { name: 'External URLs', value: Object.entries(result.externalUrls || {}).map(([key, value]) => `[${key}](${value})`).join(' • ') || 'None', inline: false }
          );
        break;

      case 'podcast':
        embed
          .setDescription(result.description)
          .addFields(
            { name: 'Publisher', value: result.publisher, inline: true },
            { name: 'Total Episodes', value: result.totalEpisodes.toString(), inline: true },
            { name: 'Languages', value: result.languages, inline: true },
            { name: 'Explicit', value: result.explicit ? 'Yes' : 'No', inline: true },
            { name: 'Media Type', value: result.mediaType || 'Unknown', inline: true },
            { name: 'Copyright', value: result.copyrights?.map(c => c.text).join('\n') || 'Unknown', inline: false },
            { name: 'Available Markets', value: result.availableMarkets?.length ? `${result.availableMarkets.length} markets` : 'Unknown', inline: true },
            { 
              name: 'Latest Episodes', 
              value: result.episodes.slice(0, 5).map(episode => 
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
   * @param {number} ms - Duration in milliseconds.
   * @returns {string} Formatted duration string.
   */
  formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  },

  /**
   * Formats a number with commas for readability.
   * @param {number} num - The number to format.
   * @returns {string} Formatted number string.
   */
  formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
}; 