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
        .setName('related-artist')
        .setDescription('Find artists related to a specific artist.')
        .addStringOption(option =>
          option
            .setName('artist')
            .setDescription('What artist do you want to find related artists for?')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('similar-songs')
        .setDescription('Find songs similar to a specific track.')
        .addStringOption(option =>
          option
            .setName('track')
            .setDescription('What track do you want to find similar songs for?')
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
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('top-tracks')
        .setDescription('Get top tracks for a country or globally.')
        .addStringOption(option =>
          option
            .setName('country')
            .setDescription('What country do you want to search for? (e.g., US, GB, global)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('top-artists')
        .setDescription('Get top artists for a country or globally.')
        .addStringOption(option =>
          option
            .setName('country')
            .setDescription('What country do you want to search for? (US, GB, global)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('year')
        .setDescription('Search for music from a specific year.')
        .addStringOption(option =>
          option
            .setName('year')
            .setDescription('What year do you want to search for? (e.g., 2023, 2024, 2025)')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('decade')
        .setDescription('Search for music from a specific decade.')
        .addStringOption(option =>
          option
            .setName('decade')
            .setDescription('What decade do you want to search for? (eg. 1980s, 1990s, 2000s)')
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

      const query = interaction.options.getString('query');
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
          result = await this.searchSong(query, accessToken);
          break;
        case 'album':
          result = await this.searchAlbum(query, accessToken);
          break;
        case 'artist':
          result = await this.searchArtist(query, accessToken);
          break;
        case 'playlist':
          result = await this.searchPlaylist(query, accessToken);
          break;
        case 'related-artist':
          result = await this.searchRelatedArtists(query, accessToken);
          break;
        case 'similar-songs':
          result = await this.searchSimilarSongs(query, accessToken);
          break;
        case 'podcast':
          result = await this.searchPodcast(query, accessToken);
          break;
        case 'top-tracks':
          result = await this.searchTopTracks(interaction.options.getString('country') || 'global', accessToken);
          break;
        case 'top-artists':
          result = await this.searchTopArtists(interaction.options.getString('country') || 'global', accessToken);
          break;
        case 'year':
          result = await this.searchByYear(query, accessToken);
          break;
        case 'decade':
          result = await this.searchByDecade(query, accessToken);
          break;
      }

      if (!result) {
        return await interaction.editReply({
          content: `⚠️ No results found for "${query}"`,
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
        url: track.external_urls.spotify,
        imageUrl: track.album.images[0]?.url,
        duration: this.formatDuration(track.duration_ms),
        popularity: track.popularity,
        releaseDate: track.album.release_date,
        trackNumber: track.track_number,
        totalTracks: track.album.total_tracks,
        explicit: track.explicit
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
        popularity: album.popularity,
        genres: albumDetails.data.genres
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
        genres: artist.genres.slice(0, 3).join(', '),
        topTracks: topTracksResponse.data.tracks.map(track => track.name).slice(0, 5)
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

      return {
        type: 'playlist',
        name: playlist.name,
        owner: playlist.owner.display_name,
        url: playlist.external_urls.spotify,
        imageUrl: playlist.images[0]?.url,
        tracks: playlist.tracks.total,
        description: playlist.description,
        followers: playlistDetails.data.followers.total,
        lastUpdated: playlistDetails.data.snapshot_id,
        collaborative: playlistDetails.data.collaborative,
        public: playlistDetails.data.public
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
   * Searches for artists related to a specific artist.
   * @param {string} artistName - The name of the artist.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The related artists data or null if not found.
   */
  async searchRelatedArtists(artistName, accessToken) {
    try {
      // First, search for the artist
      const searchResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: artistName,
          type: 'artist',
          limit: 1
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!searchResponse.data.artists.items.length) {
        return null;
      }

      const artist = searchResponse.data.artists.items[0];

      // Get related artists
      const relatedResponse = await axios.get(
        `${SPOTIFY_API_BASE_URL}/artists/${artist.id}/related-artists`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          timeout: REQUEST_TIMEOUT
        }
      );

      return {
        type: 'related-artists',
        name: artist.name,
        url: artist.external_urls.spotify,
        imageUrl: artist.images[0]?.url,
        relatedArtists: relatedResponse.data.artists.map(artist => ({
          name: artist.name,
          url: artist.external_urls.spotify,
          followers: artist.followers.total,
          popularity: artist.popularity,
          genres: artist.genres.slice(0, 3).join(', ')
        }))
      };
    } catch (error) {
      logger.error("Failed to search for related artists:", {
        error: error.message,
        artistName
      });
      return null;
    }
  },

  /**
   * Searches for songs similar to a specific track.
   * @param {string} trackName - The name of the track.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The similar songs data or null if not found.
   */
  async searchSimilarSongs(trackName, accessToken) {
    try {
      // First, search for the track
      const searchResponse = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: trackName,
          type: 'track',
          limit: 1
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!searchResponse.data.tracks.items.length) {
        return null;
      }

      const track = searchResponse.data.tracks.items[0];

      // Get recommendations based on the track
      const recommendationsResponse = await axios.get(
        `${SPOTIFY_API_BASE_URL}/recommendations`,
        {
          params: {
            seed_tracks: track.id,
            limit: 10
          },
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          timeout: REQUEST_TIMEOUT
        }
      );

      return {
        type: 'similar-songs',
        name: track.name,
        url: track.external_urls.spotify,
        imageUrl: track.album.images[0]?.url,
        similarSongs: recommendationsResponse.data.tracks.map(track => ({
          name: track.name,
          artists: track.artists.map(artist => artist.name).join(', '),
          url: track.external_urls.spotify,
          duration: this.formatDuration(track.duration_ms),
          popularity: track.popularity
        }))
      };
    } catch (error) {
      logger.error("Failed to search for similar songs:", {
        error: error.message,
        trackName
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
   * Searches for top tracks in a country or globally.
   * @param {string} country - The country code or 'global'.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The top tracks data or null if not found.
   */
  async searchTopTracks(country, accessToken) {
    try {
      const response = await axios.get(
        `${SPOTIFY_API_BASE_URL}/playlists/37i9dQZEVXbMDoHDwVN2tF`, // Global Top 50 playlist
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          timeout: REQUEST_TIMEOUT
        }
      );

      return {
        type: 'top-tracks',
        name: `Top Tracks ${country.toUpperCase()}`,
        url: response.data.external_urls.spotify,
        imageUrl: response.data.images[0]?.url,
        tracks: response.data.tracks.items.map(item => ({
          name: item.track.name,
          artists: item.track.artists.map(artist => artist.name).join(', '),
          url: item.track.external_urls.spotify,
          duration: this.formatDuration(item.track.duration_ms),
          popularity: item.track.popularity
        }))
      };
    } catch (error) {
      logger.error("Failed to search for top tracks:", {
        error: error.message,
        country
      });
      return null;
    }
  },

  /**
   * Searches for top artists in a country or globally.
   * @param {string} country - The country code or 'global'.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The top artists data or null if not found.
   */
  async searchTopArtists(country, accessToken) {
    try {
      const response = await axios.get(
        `${SPOTIFY_API_BASE_URL}/playlists/37i9dQZEVXbMDoHDwVN2tF`, // Global Top 50 playlist
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          timeout: REQUEST_TIMEOUT
        }
      );

      // Extract unique artists from the top tracks
      const artists = new Map();
      response.data.tracks.items.forEach(item => {
        item.track.artists.forEach(artist => {
          if (!artists.has(artist.id)) {
            artists.set(artist.id, {
              name: artist.name,
              url: artist.external_urls.spotify,
              popularity: item.track.popularity
            });
          }
        });
      });

      return {
        type: 'top-artists',
        name: `Top Artists ${country.toUpperCase()}`,
        url: response.data.external_urls.spotify,
        imageUrl: response.data.images[0]?.url,
        artists: Array.from(artists.values())
          .sort((a, b) => b.popularity - a.popularity)
          .slice(0, 10)
      };
    } catch (error) {
      logger.error("Failed to search for top artists:", {
        error: error.message,
        country
      });
      return null;
    }
  },

  /**
   * Searches for music from a specific year.
   * @param {string} year - The year to search for.
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The year search results or null if not found.
   */
  async searchByYear(year, accessToken) {
    try {
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: `year:${year}`,
          type: 'track',
          limit: 10
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!response.data.tracks.items.length) {
        return null;
      }

      return {
        type: 'year',
        name: `Music from ${year}`,
        tracks: response.data.tracks.items.map(track => ({
          name: track.name,
          artists: track.artists.map(artist => artist.name).join(', '),
          album: track.album.name,
          url: track.external_urls.spotify,
          imageUrl: track.album.images[0]?.url,
          duration: this.formatDuration(track.duration_ms),
          popularity: track.popularity
        }))
      };
    } catch (error) {
      logger.error("Failed to search by year:", {
        error: error.message,
        year
      });
      return null;
    }
  },

  /**
   * Searches for music from a specific decade.
   * @param {string} decade - The decade to search for (e.g., '80s', '90s').
   * @param {string} accessToken - The Spotify access token.
   * @returns {Promise<Object|null>} The decade search results or null if not found.
   */
  async searchByDecade(decade, accessToken) {
    try {
      // Convert decade to year range
      const startYear = parseInt(decade.replace('s', '0'));
      const endYear = startYear + 9;
      
      const response = await axios.get(`${SPOTIFY_API_BASE_URL}/search`, {
        params: {
          q: `year:${startYear}-${endYear}`,
          type: 'track',
          limit: 10
        },
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: REQUEST_TIMEOUT
      });

      if (!response.data.tracks.items.length) {
        return null;
      }

      return {
        type: 'decade',
        name: `Music from the ${decade}`,
        tracks: response.data.tracks.items.map(track => ({
          name: track.name,
          artists: track.artists.map(artist => artist.name).join(', '),
          album: track.album.name,
          url: track.external_urls.spotify,
          imageUrl: track.album.images[0]?.url,
          duration: this.formatDuration(track.duration_ms),
          popularity: track.popularity,
          year: track.album.release_date.split('-')[0]
        }))
      };
    } catch (error) {
      logger.error("Failed to search by decade:", {
        error: error.message,
        decade
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
            { name: 'Album', value: result.album, inline: true },
            { name: 'Duration', value: result.duration, inline: true },
            { name: 'Popularity', value: `${result.popularity}%`, inline: true },
            { name: 'Release Date', value: result.releaseDate || 'Unknown', inline: true },
            { name: 'Track Number', value: result.trackNumber ? `${result.trackNumber}/${result.totalTracks}` : 'Unknown', inline: true },
            { name: 'Explicit', value: result.explicit ? 'Yes' : 'No', inline: true }
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
            { name: 'Popularity', value: `${result.popularity}%`, inline: true },
            { name: 'Genres', value: result.genres?.join(', ') || 'No genres listed', inline: false }
          );
        break;

      case 'artist':
        embed
          .addFields(
            { name: 'Followers', value: this.formatNumber(result.followers), inline: true },
            { name: 'Popularity', value: `${result.popularity}%`, inline: true },
            { name: 'Genres', value: result.genres || 'No genres listed', inline: false },
            { name: 'Top Tracks', value: result.topTracks?.join('\n') || 'No top tracks available', inline: false }
          );
        break;

      case 'playlist':
        embed
          .setDescription(result.description || 'No description available')
          .addFields(
            { name: 'Created by', value: result.owner, inline: true },
            { name: 'Tracks', value: result.tracks.toString(), inline: true },
            { name: 'Followers', value: this.formatNumber(result.followers) || 'Unknown', inline: true },
            { name: 'Last Updated', value: result.lastUpdated || 'Unknown', inline: true },
            { name: 'Collaborative', value: result.collaborative ? 'Yes' : 'No', inline: true },
            { name: 'Public', value: result.public ? 'Yes' : 'No', inline: true }
          );
        break;

      case 'related-artists':
        embed
          .setDescription(`Related artists for ${result.name}`)
          .addFields(
            { 
              name: 'Related Artists', 
              value: result.relatedArtists.map(artist => 
                `[${artist.name}](${artist.url}) - ${this.formatNumber(artist.followers)} followers`
              ).join('\n'),
              inline: false 
            }
          );
        break;

      case 'similar-songs':
        embed
          .setDescription(`Songs similar to ${result.name}`)
          .addFields(
            { 
              name: 'Similar Songs', 
              value: result.similarSongs.map(song => 
                `[${song.name}](${song.url}) - ${song.artists} (${song.duration})`
              ).join('\n'),
              inline: false 
            }
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
            { 
              name: 'Latest Episodes', 
              value: result.episodes.slice(0, 5).map(episode => 
                `[${episode.name}](${episode.url}) - ${episode.duration} (${episode.releaseDate})`
              ).join('\n'),
              inline: false 
            }
          );
        break;

      case 'top-tracks':
        embed
          .setDescription(`Top tracks in ${result.name}`)
          .addFields(
            { 
              name: 'Top Tracks', 
              value: result.tracks.map((track, index) => 
                `${index + 1}. [${track.name}](${track.url}) - ${track.artists} (${track.duration})`
              ).join('\n'),
              inline: false 
            }
          );
        break;

      case 'top-artists':
        embed
          .setDescription(`Top artists in ${result.name}`)
          .addFields(
            { 
              name: 'Top Artists', 
              value: result.artists.map((artist, index) => 
                `${index + 1}. [${artist.name}](${artist.url})`
              ).join('\n'),
              inline: false 
            }
          );
        break;

      case 'year':
        embed
          .setDescription(`Popular tracks from ${result.name}`)
          .addFields(
            { 
              name: 'Tracks', 
              value: result.tracks.map(track => 
                `[${track.name}](${track.url}) - ${track.artists} (${track.duration})`
              ).join('\n'),
              inline: false 
            }
          );
        break;

      case 'decade':
        embed
          .setDescription(`Popular tracks from ${result.name}`)
          .addFields(
            { 
              name: 'Tracks', 
              value: result.tracks.map(track => 
                `[${track.name}](${track.url}) - ${track.artists} (${track.year})`
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