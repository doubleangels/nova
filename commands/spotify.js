const { SlashCommandBuilder, EmbedBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const path = require('path');
const dayjs = require('dayjs');
const logger = require('../logger')(path.basename(__filename));
const axios = require('axios');
const config = require('../config');
const { createPaginatedResults } = require('../utils/searchUtils');

/**
 * Command module for searching and displaying Spotify content.
 * Supports searching for songs, albums, artists, playlists, and podcasts.
 * @type {Object}
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('spotify')
    .setDescription('Search for music on Spotify.')
    .setDefaultMemberPermissions(null)
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
   * This function:
   * 1. Validates API configuration
   * 2. Gets Spotify access token
   * 3. Performs search based on subcommand
   * 4. Displays results with pagination
   * 
   * @param {CommandInteraction} interaction - The interaction that triggered the command
   * @throws {Error} If there's an error during command execution
   * @returns {Promise<void>}
   */
  async execute(interaction) {
    try {
      if (!this.validateConfiguration()) {
        return await interaction.reply({
          content: "⚠️ This command is not properly configured. Please contact an administrator.",
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply();
      logger.info('/spotify command initiated.', {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        subcommand: interaction.options.getSubcommand()
      });

      const subcommand = interaction.options.getSubcommand();

      const accessToken = await this.getSpotifyAccessToken();
      if (!accessToken) {
        return await interaction.editReply({
          content: "⚠️ Spotify API access denied. Please check API configuration.",
          flags: MessageFlags.Ephemeral
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
          content: "⚠️ No results found for your search.",
          flags: MessageFlags.Ephemeral
        });
      }

      const generateEmbed = (index) => this.createEmbed(results, subcommand, index);

      await createPaginatedResults(
        interaction,
        results,
        generateEmbed,
        'spotify',
        120000,
        logger,
        {
          buttonStyle: ButtonStyle.Secondary,
          prevLabel: "Previous",
          nextLabel: "Next",
          prevEmoji: "◀️",
          nextEmoji: "▶️"
        }
      );

      logger.info("/spotify command completed successfully.", {
        userId: interaction.user.id,
        subcommand: subcommand,
        query: interaction.options.getString('query'),
        resultCount: results.length
      });

    } catch (error) {
      await this.handleError(interaction, error);
    }
  },

  /**
   * Validates that required Spotify API configuration is present.
   * 
   * @returns {boolean} True if configuration is valid, false otherwise
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
   * Retrieves a Spotify access token using client credentials.
   * 
   * @returns {Promise<string|null>} The access token or null if authentication fails
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
          timeout: 10000
        }
      );

      return response.data.access_token;
    } catch (error) {
      logger.error("Failed to get Spotify access token.", {
        err: error
      });
      return null;
    }
  },

  async searchSong(query, accessToken) {
    try {
      const response = await axios.get('https://api.spotify.com/v1/search', {
        params: {
          q: query,
          type: 'track',
          limit: 10
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 10000
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
      logger.error("Failed to search for song.", {
        err: error,
        query
      });
      return null;
    }
  },

  async searchAlbum(query, accessToken) {
    try {
      const response = await axios.get('https://api.spotify.com/v1/search', {
        params: {
          q: query,
          type: 'album',
          limit: 10
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 10000
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
      logger.error("Failed to search for album.", {
        err: error,
        query
      });
      return null;
    }
  },

  async searchArtist(query, accessToken) {
    try {
      const response = await axios.get('https://api.spotify.com/v1/search', {
        params: {
          q: query,
          type: 'artist',
          limit: 10
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 10000
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
      logger.error("Failed to search for artist.", {
        err: error,
        query
      });
      return null;
    }
  },

  async searchPlaylist(query, accessToken) {
    try {
      const response = await axios.get('https://api.spotify.com/v1/search', {
        params: {
          q: query,
          type: 'playlist',
          limit: 10
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 10000
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
        lastUpdated: dayjs(playlist.modified_at).format('MMMM D, YYYY'),
        collaborative: playlist.collaborative,
        public: playlist.public,
        snapshotId: playlist.snapshot_id
      }));

      return playlists;
    } catch (error) {
      logger.error("Failed to search for playlist.", {
        err: error,
        query
      });
      return null;
    }
  },

  async searchPodcast(query, accessToken) {
    try {
      const response = await axios.get('https://api.spotify.com/v1/search', {
        params: {
          q: query,
          type: 'show',
          limit: 10
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 10000
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
      logger.error("Failed to search for podcast.", {
        err: error,
        query
      });
      return null;
    }
  },

  createEmbed(results, type, index = 0) {
    const item = results[index];

    if (!item) {
      throw new Error("No result data available");
    }

    let fields;
    switch (type) {
      case 'song':
        fields = [
          { name: 'Album', value: `[${item.album}](${item.albumUrl})`, inline: true },
          { name: 'Duration', value: item.duration, inline: true },
          { name: 'Popularity', value: `${item.popularity}%`, inline: true },
          { name: 'Release Date', value: this.formatReleaseDate(item.releaseDate), inline: true },
          { name: 'Track Number', value: item.trackNumber ? `${item.trackNumber}/${item.totalTracks}` : 'Unknown', inline: true },
          { name: 'Explicit', value: item.explicit ? 'Yes' : 'No', inline: true },
          { name: 'Disc Number', value: item.discNumber?.toString() || 'Unknown', inline: true },
          { name: 'ISRC', value: item.isrc || 'Unknown', inline: true }
        ];
        break;
      case 'album':
        fields = [
          { name: 'Release Date', value: this.formatReleaseDate(item.releaseDate), inline: true },
          { name: 'Tracks', value: item.totalTracks.toString(), inline: true },
          { name: 'Album Type', value: item.albumType || 'Unknown', inline: true },
          { name: 'Label', value: item.label || 'Unknown', inline: true },
          { name: 'Copyright', value: item.copyrights?.map(c => c.text).join('\n') || 'Unknown', inline: false },
          { name: 'Available Markets', value: item.availableMarkets?.length ? `${item.availableMarkets.length} markets` : 'Unknown', inline: true }
        ];
        break;
      case 'artist':
        fields = [
          { name: 'Followers', value: this.formatNumber(item.followers), inline: true },
          { name: 'Popularity', value: `${item.popularity}%`, inline: true },
          { name: 'Genres', value: item.genres?.join(', ') || 'No genres listed', inline: false },
          { name: 'Top Tracks', value: item.topTracks?.map(track => `[${track.name}](${track.url})`).join('\n') || 'No top tracks available', inline: false }
        ];
        break;
      case 'playlist':
        fields = [
          { name: 'Created by', value: `[${item.owner}](${item.ownerUrl})`, inline: true },
          { name: 'Tracks', value: item.tracks.toString(), inline: true },
          { name: 'Followers', value: this.formatNumber(item.followers) || 'Unknown', inline: true },
          { name: 'Last Updated', value: item.lastUpdated || 'Unknown', inline: true },
          { name: 'Collaborative', value: item.collaborative ? 'Yes' : 'No', inline: true },
          { name: 'Public', value: item.public ? 'Yes' : 'No', inline: true },
          { name: 'Snapshot ID', value: item.snapshotId || 'Unknown', inline: true }
        ];
        break;
      case 'podcast':
        fields = [
          { name: 'Publisher', value: item.publisher, inline: true },
          { name: 'Total Episodes', value: item.totalEpisodes.toString(), inline: true },
          { name: 'Languages', value: item.languages, inline: true },
          { name: 'Explicit', value: item.explicit ? 'Yes' : 'No', inline: true },
          { name: 'Copyright', value: item.copyrights?.map(c => c.text).join('\n') || 'Unknown', inline: false },
          { name: 'Available Markets', value: item.availableMarkets?.length ? `${item.availableMarkets.length} markets` : 'Unknown', inline: true },
          {
            name: 'Latest Episodes',
            value: item.episodes.slice(0, 5).map(episode =>
              `[${episode.name}](${episode.url}) - ${episode.duration} (${this.formatReleaseDate(episode.releaseDate)})`
            ).join('\n'),
            inline: false
          }
        ];
        break;
      default:
        fields = [];
    }

    const embed = new EmbedBuilder()
      .setColor(0x1DB954)
      .setTitle(item.name)
      .setURL(item.url)
      .setThumbnail(item.imageUrl)
      .setFooter({
        text: `Powered by Spotify • Result ${index + 1} of ${results.length}`
      });

    if (type === 'song' || type === 'album') {
      embed.setDescription(`**${item.artists}**`);
    } else if (type === 'playlist') {
      embed.setDescription(item.description || 'No description available');
    } else if (type === 'podcast') {
      embed.setDescription(item.description);
    }

    if (fields.length > 0) {
      embed.addFields(fields);
    }

    return embed;
  },

  formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  },

  formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  },

  /**
   * Formats a release date string to a readable date format
   * @param {string} releaseDate - The release date string (YYYY-MM-DD, YYYY-MM, or YYYY)
   * @returns {string} Formatted date or 'Unknown'
   */
  formatReleaseDate(releaseDate) {
    if (!releaseDate || releaseDate === 'Unknown') {
      return 'Unknown';
    }

    try {
      // Handle different date formats from Spotify API
      let date;
      if (releaseDate.length === 4) {
        // Year only - just return the year
        return releaseDate;
      } else if (releaseDate.length === 7) {
        // Year-Month - format as "Month YYYY"
        const date = dayjs(`${releaseDate}-01`);
        if (!date.isValid()) {
          return releaseDate;
        }
        return date.format('MMMM YYYY');
      } else {
        // Full date - format as readable date
        const date = dayjs(releaseDate);
        if (!date.isValid()) {
          return releaseDate;
        }
        return date.format('MMMM D, YYYY');
      }
    } catch (error) {
      return releaseDate;
    }
  },

  async handleError(interaction, error) {
    logger.error("Error occurred in spotify command.", {
      err: error,
      userId: interaction.user?.id,
      guildId: interaction.guild?.id
    });

    let errorMessage = "⚠️ An unexpected error occurred while searching Spotify. Please try again later.";

    if (error.message === "API_ERROR") {
      errorMessage = "⚠️ Failed to search Spotify. Please try again later.";
    } else if (error.message === "API_RATE_LIMIT") {
      errorMessage = "⚠️ Rate limit exceeded. Please try again in a few minutes.";
    } else if (error.message === "API_NETWORK_ERROR") {
      errorMessage = "⚠️ Network error occurred. Please check your internet connection.";
    } else if (error.message === "NO_RESULTS") {
      errorMessage = "⚠️ No results found for your search.";
    } else if (error.message === "INVALID_TRACK") {
      errorMessage = "⚠️ Invalid track specified.";
    } else if (error.message === "AUTH_ERROR") {
      errorMessage = "⚠️ Failed to authenticate with Spotify.";
    }

    try {
      await interaction.editReply({
        content: errorMessage,
        flags: MessageFlags.Ephemeral
      });
    } catch (followUpError) {
      logger.error("Failed to send error response for spotify command.", {
        err: followUpError,
        originalError: error.message,
        userId: interaction.user?.id
      });

      await interaction.reply({
        content: errorMessage,
        flags: MessageFlags.Ephemeral
      }).catch(() => { });
    }
  }
}; 