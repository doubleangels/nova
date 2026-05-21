const { createMockInteraction } = require('../testUtils');

const mockLogger = {
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};
jest.mock('../../logger', () => () => mockLogger);

const mockGetGeocodingData = jest.fn();
const mockGetTimezoneData = jest.fn();
jest.mock('../../utils/locationUtils', () => ({
  getGeocodingData: mockGetGeocodingData,
  getTimezoneData: mockGetTimezoneData
}));

describe('weather command', () => {
  let weatherCommand;
  let mockConfig;
  let mockAxios;

  beforeEach(() => {
    jest.resetModules();

    mockConfig = {
      pirateWeatherApiKey: 'mock-weather-key'
    };
    jest.doMock('../../config', () => mockConfig);

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    mockGetGeocodingData.mockReset();
    mockGetTimezoneData.mockReset();
    jest.doMock('../../utils/locationUtils', () => ({
      getGeocodingData: mockGetGeocodingData,
      getTimezoneData: mockGetTimezoneData
    }));

    weatherCommand = require('../../commands/weather');
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should reply with error if pirateWeatherApiKey is missing', async () => {
      mockConfig.pirateWeatherApiKey = null;
      const mockInteraction = createMockInteraction();

      await weatherCommand.execute(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalled();
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ This command is not properly configured. Please contact an administrator.'
      }));
      expect(mockLogger.error).toHaveBeenCalledWith('Weather API key is missing in configuration.');
    });

    it('should reply with error if geocoding fails (geocodeResult.error is true)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'place') return 'UnknownPlace123';
            return null;
          }),
          getBoolean: jest.fn().mockReturnValue(false),
          getInteger: jest.fn().mockReturnValue(null)
        }
      });

      mockGetGeocodingData.mockResolvedValueOnce({
        error: true,
        type: 'INVALID_LOCATION'
      });

      await weatherCommand.execute(mockInteraction);

      expect(mockGetGeocodingData).toHaveBeenCalledWith('UnknownPlace123');
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to get coordinates for the specified location. Please try a different place name.'
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to get coordinates for location:', expect.any(Object));
    });

    it('should reply with error if fetchWeatherData returns null', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'place') return 'Paris';
            return null;
          }),
          getBoolean: jest.fn().mockReturnValue(false),
          getInteger: jest.fn().mockReturnValue(null)
        }
      });

      mockGetGeocodingData.mockResolvedValueOnce({
        error: false,
        location: { lat: 48.8566, lng: 2.3522 },
        formattedAddress: 'Paris, France'
      });
      mockGetTimezoneData.mockResolvedValueOnce({ timezoneId: 'Europe/Paris', error: false });

      jest.spyOn(weatherCommand, 'fetchWeatherData').mockResolvedValueOnce(null);

      await weatherCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to fetch weather data. Please try again later.'
      }));
      expect(mockLogger.warn).toHaveBeenCalledWith('Failed to fetch weather data:', expect.any(Object));
    });

    it('should successfully fetch weather and display details in metric (privacy mode default / true)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'place') return 'Paris';
            if (name === 'units') return 'metric';
            return null;
          }),
          getBoolean: jest.fn().mockReturnValue(true), // privacy-mode true
          getInteger: jest.fn().mockReturnValue(3)
        }
      });

      mockGetGeocodingData.mockResolvedValueOnce({
        error: false,
        location: { lat: 48.8566, lng: 2.3522 },
        formattedAddress: 'Paris, France'
      });

      const mockWeatherData = {
        currently: {
          summary: 'Clear',
          icon: 'clear-day',
          temperature: 15.5,
          apparentTemperature: 15.0,
          humidity: 0.6,
          windSpeed: 3.5,
          windBearing: 90,
          uvIndex: 4,
          visibility: 10,
          pressure: 1013,
          dewPoint: 8.0,
          cloudCover: 0.1,
          precipIntensity: 0,
          precipProbability: 0
        },
        daily: {
          data: [
            { time: 1716076800, summary: 'Sunny day', icon: 'clear-day', temperatureHigh: 20.0, temperatureLow: 10.0, precipProbability: 0.1 }
          ]
        }
      };

      jest.spyOn(weatherCommand, 'fetchWeatherData').mockResolvedValueOnce(mockWeatherData);
      mockGetTimezoneData.mockResolvedValueOnce({
        timezoneId: 'Europe/Paris',
        error: false
      });

      await weatherCommand.execute(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: expect.any(Array)
      }));

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.title).toBe('Weather'); // hidden location
      expect(sentEmbed.data.description).toBe('**Clear**');

      const fields = sentEmbed.data.fields;
      expect(fields.find(f => f.name === '🌡️ Temperature').value).toBe('15.5°C');
      expect(fields.find(f => f.name === '💧 Humidity').value).toBe('60%');
      expect(fields.find(f => f.name === '🌬️ Wind Speed').value).toBe('3.5 m/s (E)');
      expect(fields.find(f => f.name === '👁️ Visibility').value).toBe('10 km');
      expect(fields.find(f => f.name === '📈 Pressure').value).toBe('1013 hPa');
      expect(fields.find(f => f.name === '📆 3-Day Forecast').value).toContain('05/19/2024');

      expect(mockLogger.info).toHaveBeenCalledWith('/weather command completed successfully:', expect.any(Object));
    });

    it('should successfully fetch weather and display details in imperial (privacy mode false)', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockImplementation((name) => {
            if (name === 'place') return 'New York';
            if (name === 'units') return 'imperial';
            return null;
          }),
          getBoolean: jest.fn().mockReturnValue(false), // privacy-mode false
          getInteger: jest.fn().mockReturnValue(null) // defaults to 3 days
        }
      });

      mockGetGeocodingData.mockResolvedValueOnce({
        error: false,
        location: { lat: 40.7128, lng: -74.0060 },
        formattedAddress: 'New York, NY, USA'
      });

      const mockWeatherData = {
        currently: {
          summary: 'Rainy',
          icon: 'rain',
          temperature: 60.5,
          apparentTemperature: 58.0,
          humidity: 0.9,
          windSpeed: 10.5,
          windBearing: 180,
          uvIndex: 1,
          visibility: 5,
          pressure: 1013,
          dewPoint: 57.0,
          cloudCover: 0.9,
          precipIntensity: 0.1,
          precipProbability: 0.8
        },
        daily: {
          data: [
            { time: 1716076800, summary: 'Heavy Rain', icon: 'rain', temperatureHigh: 65.0, temperatureLow: 55.0, precipProbability: 0.9 }
          ]
        }
      };

      jest.spyOn(weatherCommand, 'fetchWeatherData').mockResolvedValueOnce(mockWeatherData);
      mockGetTimezoneData.mockResolvedValueOnce({
        timezoneId: 'America/New_York',
        error: false
      });

      await weatherCommand.execute(mockInteraction);

      const sentEmbed = mockInteraction.editReply.mock.calls[0][0].embeds[0];
      expect(sentEmbed.data.title).toBe('Weather in New York, NY, USA'); // not hidden
      
      const fields = sentEmbed.data.fields;
      expect(fields.find(f => f.name === '🌡️ Temperature').value).toBe('60.5°F');
      expect(fields.find(f => f.name === '🌬️ Wind Speed').value).toBe('10.5 mph (S)');
      expect(fields.find(f => f.name === '👁️ Visibility').value).toBe('5 mi');
      // 1013 * 0.02953 = 29.91
      expect(fields.find(f => f.name === '📈 Pressure').value).toBe('29.91 inHg');
    });

    it('should catch errors thrown during execution and forward to handleError', async () => {
      const mockInteraction = createMockInteraction({
        options: {
          getString: jest.fn().mockReturnValue('Paris')
        }
      });

      mockGetGeocodingData.mockRejectedValueOnce(new Error('Geocoding crash'));

      await weatherCommand.execute(mockInteraction);

      expect(mockLogger.error).toHaveBeenCalledWith('Error in weather command', expect.any(Object));
      expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ An unexpected error occurred while fetching weather information. Please try again later.'
      }));
    });
  });

  describe('fetchWeatherData', () => {
    it('should return weather data on 200 response', async () => {
      mockAxios.get.mockResolvedValueOnce({
        status: 200,
        data: { currently: { summary: 'Hot' } }
      });

      const res = await weatherCommand.fetchWeatherData(10, 20, 'si');
      expect(res).toEqual({ currently: { summary: 'Hot' } });
      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://api.pirateweather.net/forecast/mock-weather-key/10,20?units=si',
        { timeout: 5000 }
      );
    });

    it('should return null on non-200 response status', async () => {
      mockAxios.get.mockResolvedValueOnce({
        status: 500,
        statusText: 'Internal Error'
      });

      const res = await weatherCommand.fetchWeatherData(10, 20, 'si');
      expect(res).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('PirateWeather API returned non-200 status:', expect.any(Object));
    });

    it('should return null if axios.get throws an error', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Network error'));

      const res = await weatherCommand.fetchWeatherData(10, 20, 'si');
      expect(res).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching weather data from API', expect.any(Object));
    });
  });

  describe('createWeatherEmbed Details & Timezone Fallback', () => {
    it('should fall back to UTC time when timezone lookup failed', async () => {
      const mockWeatherData = {
        currently: {
          apparentTemperature: 12.0,
          humidity: 0.5,
          windSpeed: 2.0,
          windBearing: 45
        },
        daily: { data: [] }
      };

      const embed = await weatherCommand.createWeatherEmbed(
        'Paris', 48.85, 2.35, mockWeatherData, 'metric', 3, false, { timezoneId: null, error: true }
      );
      expect(embed.data.title).toBe('Weather in Paris');
    });

    it('should fall back to UTC if timezoneResult.error is true', async () => {
      const mockWeatherData = {
        currently: {
          apparentTemperature: 12.0,
          humidity: 0.5,
          windSpeed: 2.0,
          windBearing: 45
        },
        daily: { data: [] }
      };

      const embed = await weatherCommand.createWeatherEmbed(
        'Paris', 48.85, 2.35, mockWeatherData, 'metric', 3, false, { error: true }
      );
      expect(embed.data.title).toBe('Weather in Paris');
    });

    it('should support daily forecast dates using UTC if timezoneId is null or empty', async () => {
      mockGetTimezoneData.mockResolvedValueOnce({ timezoneId: null, error: false });
      const mockWeatherData = {
        currently: {},
        daily: {
          data: [
            { time: 1716076800, summary: 'Cloudy', temperatureHigh: null, temperatureLow: null, precipProbability: null }
          ]
        }
      };

      const embed = await weatherCommand.createWeatherEmbed('Paris', 48.85, 2.35, mockWeatherData, 'metric', 3, true);
      const forecastField = embed.data.fields.find(f => f.name.includes('Forecast'));
      expect(forecastField.value).toContain('05/19/2024');
      expect(forecastField.value).toContain('High: N/A');
      expect(forecastField.value).toContain('Low: N/A');
      expect(forecastField.value).toContain('Precipitation: 0%');
    });

    it('should support completely empty/falsy daily forecast fields', async () => {
      mockGetTimezoneData.mockResolvedValueOnce({ timezoneId: null, error: false });
      const mockWeatherData = {
        currently: {
          dewPoint: undefined
        },
        daily: {
          data: [
            { time: null, summary: null, icon: null }
          ]
        }
      };

      const embed = await weatherCommand.createWeatherEmbed('Paris', 48.85, 2.35, mockWeatherData, 'metric', 3, true);
      const forecastField = embed.data.fields.find(f => f.name.includes('Forecast'));
      expect(forecastField.value).toContain('Unknown date');
      expect(forecastField.value).toContain('No data');
    });

    it('should support empty daily array', async () => {
      mockGetTimezoneData.mockResolvedValueOnce({ timezoneId: null, error: false });
      const mockWeatherData = {
        currently: {}
      };

      const embed = await weatherCommand.createWeatherEmbed('Paris', 48.85, 2.35, mockWeatherData, 'metric', 3, true);
      const forecastField = embed.data.fields.find(f => f.name.includes('Forecast'));
      expect(forecastField.value).toBe('No forecast data available.');
    });

    it('should cover default parameter hideLocation and falsy daily elements', async () => {
      mockGetTimezoneData.mockResolvedValueOnce({ timezoneId: 'Europe/Paris', error: false });
      const mockWeatherData = {
        currently: {},
        daily: {
          data: [null]
        }
      };

      const embed = await weatherCommand.createWeatherEmbed('Paris', 48.85, 2.35, mockWeatherData, 'metric', 1);
      expect(embed.data.title).toBe('Weather in Paris');
    });

    it('should cover fallback for data.currently when missing', async () => {
      mockGetTimezoneData.mockResolvedValueOnce({ timezoneId: null, error: false });
      const mockWeatherData = {
        daily: { data: [] }
      };

      const embed = await weatherCommand.createWeatherEmbed('Paris', 48.85, 2.35, mockWeatherData, 'metric', 3, true);
      expect(embed.data.title).toBe('Weather');
    });
  });

  describe('getWindDirection', () => {
    it('should return empty string if bearing is null or undefined', () => {
      expect(weatherCommand.getWindDirection(null)).toBe('');
      expect(weatherCommand.getWindDirection(undefined)).toBe('');
    });

    it('should return correct direction for various angles', () => {
      expect(weatherCommand.getWindDirection(0)).toBe('(N)');
      expect(weatherCommand.getWindDirection(22.5)).toBe('(NNE)');
      expect(weatherCommand.getWindDirection(45)).toBe('(NE)');
      expect(weatherCommand.getWindDirection(90)).toBe('(E)');
      expect(weatherCommand.getWindDirection(180)).toBe('(S)');
      expect(weatherCommand.getWindDirection(270)).toBe('(W)');
      expect(weatherCommand.getWindDirection(350)).toBe('(N)');
    });
  });

  describe('handleError', () => {
    it('should handle all custom error types correctly', async () => {
      const errorCases = [
        {
          error: new Error('API_ERROR'),
          expected: '⚠️ Failed to fetch weather data. Please try again later.'
        },
        {
          error: new Error('API_RATE_LIMIT'),
          expected: '⚠️ Rate limit exceeded. Please try again in a few minutes.'
        },
        {
          error: new Error('API_NETWORK_ERROR'),
          expected: '⚠️ Network error occurred. Please check your internet connection.'
        },
        {
          error: new Error('INVALID_LOCATION'),
          expected: '⚠️ Could not find the specified location. Please try a different place name.'
        },
        {
          error: new Error('SOME_UNEXPECTED_ERROR'),
          expected: '⚠️ An unexpected error occurred while fetching weather information. Please try again later.'
        }
      ];

      for (const errCase of errorCases) {
        jest.clearAllMocks();
        const mockInteraction = createMockInteraction();

        await weatherCommand.handleError(mockInteraction, errCase.error);

        expect(mockLogger.error).toHaveBeenCalledWith('Error in weather command', expect.any(Object));
        expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.objectContaining({
          content: errCase.expected
        }));
      }
    });

    it('should fallback to reply if editReply fails inside error catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));

      await weatherCommand.handleError(mockInteraction, error);

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to send error response for weather command', expect.any(Object));
      expect(mockInteraction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: '⚠️ Failed to fetch weather data. Please try again later.'
      }));
    });

    it('should silently catch errors if fallback reply also fails inside catch block', async () => {
      const mockInteraction = createMockInteraction();
      const error = new Error('API_ERROR');
      mockInteraction.editReply.mockRejectedValueOnce(new Error('editReply failed'));
      mockInteraction.reply.mockRejectedValueOnce(new Error('reply failed'));

      await expect(weatherCommand.handleError(mockInteraction, error)).resolves.not.toThrow();
    });
  });
});
