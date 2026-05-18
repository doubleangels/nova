describe('locationUtils', () => {
  let locationUtils;
  let mockAxios;
  let mockLogger;
  let mockConfig;

  beforeEach(() => {
    jest.resetModules();
    
    mockConfig = {
      googleApiKey: 'api-key-123'
    };
    jest.doMock('../../config', () => mockConfig);

    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn()
    };
    jest.doMock('../../logger', () => () => mockLogger);

    mockAxios = {
      get: jest.fn()
    };
    jest.doMock('axios', () => mockAxios);

    locationUtils = require('../../utils/locationUtils');
  });

  describe('secondsToHours', () => {
    it('should convert correctly', () => {
      expect(locationUtils.secondsToHours(3600)).toBe(1);
      expect(locationUtils.secondsToHours(7200)).toBe(2);
      expect(locationUtils.secondsToHours(1800)).toBe(0.5);
    });
  });

  describe('formatPlaceName', () => {
    it('should format place name', () => {
      expect(locationUtils.formatPlaceName('New York, NY, USA')).toBe('New York');
      expect(locationUtils.formatPlaceName('London')).toBe('London');
    });
  });

  describe('formatErrorMessage', () => {
    it('should handle ZERO_RESULTS', () => {
      expect(locationUtils.formatErrorMessage('Atlantis', 'Geocoding failed: ZERO_RESULTS')).toBe('⚠️ Could not find location: Atlantis');
    });
    
    it('should handle OVER_QUERY_LIMIT', () => {
      expect(locationUtils.formatErrorMessage('Paris', 'Geocoding failed: OVER_QUERY_LIMIT')).toBe('⚠️ Too many requests. Please try again later.');
    });

    it('should handle REQUEST_DENIED', () => {
      expect(locationUtils.formatErrorMessage('Paris', 'Geocoding failed: REQUEST_DENIED')).toBe('⚠️ API access denied. Please check API configuration.');
    });

    it('should handle INVALID_REQUEST', () => {
      expect(locationUtils.formatErrorMessage('London', 'Geocoding failed: INVALID_REQUEST')).toBe('⚠️ Invalid location: London');
    });

    it('should handle generic error', () => {
      expect(locationUtils.formatErrorMessage('Mars', 'Error occurred')).toBe('⚠️ Failed to get timezone information for Mars');
    });
  });

  describe('isValidTimezone', () => {
    it('should return true for valid timezones', () => {
      expect(locationUtils.isValidTimezone('America/New_York')).toBe(true);
      expect(locationUtils.isValidTimezone('Europe/London')).toBe(true);
      expect(locationUtils.isValidTimezone('UTC')).toBe(true);
    });

    it('should return false for invalid timezones', () => {
      expect(locationUtils.isValidTimezone('America/Fake_City')).toBe(false);
      expect(locationUtils.isValidTimezone('Invalid/Timezone')).toBe(false);
    });
  });

  describe('API Integrations', () => {
    const mockGeocodeResponse = {
      data: {
        status: 'OK',
        results: [{
          formatted_address: 'Tokyo, Japan',
          geometry: { location: { lat: 35.6762, lng: 139.6503 } }
        }]
      }
    };

    const mockTimezoneResponse = {
      data: {
        status: 'OK',
        timeZoneId: 'Asia/Tokyo',
        timeZoneName: 'Japan Standard Time',
        rawOffset: 32400,
        dstOffset: 0
      }
    };

    describe('getGeocodingData', () => {
      it('should fetch geocoding data', async () => {
        mockAxios.get.mockResolvedValueOnce(mockGeocodeResponse);
        const result = await locationUtils.getGeocodingData('Tokyo');
        
        expect(result.error).toBe(false);
        expect(result.formattedAddress).toBe('Tokyo, Japan');
        expect(result.location).toEqual({ lat: 35.6762, lng: 139.6503 });
        
        // Use a unique address to avoid cache hit from other tests
        mockAxios.get.mockResolvedValueOnce(mockGeocodeResponse);
        await locationUtils.getGeocodingData('Osaka');
        expect(mockAxios.get).toHaveBeenCalledTimes(2);
      });

      it('should hit geocoding cache on subsequent calls for same location', async () => {
        mockAxios.get.mockResolvedValueOnce(mockGeocodeResponse);
        
        // 1st call - cache miss
        const res1 = await locationUtils.getGeocodingData('CachePlace');
        expect(res1.error).toBe(false);
        expect(mockAxios.get).toHaveBeenCalledTimes(1);
        
        // 2nd call - cache hit
        const res2 = await locationUtils.getGeocodingData('CachePlace');
        expect(res2.error).toBe(false);
        expect(mockAxios.get).toHaveBeenCalledTimes(1); // not called again
      });

      it('should return error on failure', async () => {
        mockAxios.get.mockResolvedValueOnce({ data: { status: 'ZERO_RESULTS' } });
        const result = await locationUtils.getGeocodingData('FakePlace123');
        
        expect(result.error).toBe(true);
        expect(result.type).toContain('Geocoding failed: ZERO_RESULTS');
      });

      it('should throw error when rate limit is exceeded', async () => {
        // Mock get response for all requests
        mockAxios.get.mockResolvedValue(mockGeocodeResponse);
        
        // Loop 50 times to hit the rate limit threshold
        const promises = [];
        for (let i = 0; i < 50; i++) {
          promises.push(locationUtils.getGeocodingData(`Place_${i}`));
        }
        await Promise.all(promises);
        
        // The 51st call should trigger rate limit error
        const result = await locationUtils.getGeocodingData('Place_51');
        expect(result.error).toBe(true);
        expect(result.type).toBe('Rate limit exceeded. Please try again later.');
      });
    });

    describe('getTimezoneData', () => {
      it('should fetch timezone data', async () => {
        mockAxios.get.mockResolvedValueOnce(mockTimezoneResponse);
        const result = await locationUtils.getTimezoneData({ lat: 35.6762, lng: 139.6503 });
        
        expect(result.error).toBe(false);
        expect(result.timezoneId).toBe('Asia/Tokyo');
      });

      it('should hit timezone cache on subsequent calls for same coordinates', async () => {
        mockAxios.get.mockResolvedValueOnce(mockTimezoneResponse);
        
        // 1st call - cache miss
        const res1 = await locationUtils.getTimezoneData({ lat: 10, lng: 20 });
        expect(res1.error).toBe(false);
        expect(mockAxios.get).toHaveBeenCalledTimes(1);
        
        // 2nd call - cache hit
        const res2 = await locationUtils.getTimezoneData({ lat: 10, lng: 20 });
        expect(res2.error).toBe(false);
        expect(mockAxios.get).toHaveBeenCalledTimes(1); // not called again
      });

      it('should return error for invalid coordinates', async () => {
        const result = await locationUtils.getTimezoneData({ lat: 100, lng: 200 });
        
        expect(result.error).toBe(true);
        expect(result.type).toBe('Invalid coordinates provided');
        expect(mockAxios.get).not.toHaveBeenCalled();
      });

      it('should return error if timezone lookup status is not OK', async () => {
        mockAxios.get.mockResolvedValueOnce({
          data: { status: 'INVALID_REQUEST' }
        });
        
        const result = await locationUtils.getTimezoneData({ lat: 10, lng: 20 });
        expect(result.error).toBe(true);
        expect(result.type).toContain('Timezone lookup failed: INVALID_REQUEST');
      });
    });

    describe('getUtcOffset', () => {
      it('should calculate UTC offset', async () => {
        mockAxios.get
          .mockResolvedValueOnce(mockGeocodeResponse)
          .mockResolvedValueOnce(mockTimezoneResponse);

        // Make sure we use a unique location so it doesn't hit cache
        const result = await locationUtils.getUtcOffset('TokyoCity');
        
        expect(result.error).toBe(false);
        expect(result.offset).toBe(9); // 32400 / 3600
        expect(result.placeName).toBe('Tokyo');
        expect(result.timeZoneName).toBe('Japan Standard Time');
      });

      it('should handle errors gracefully', async () => {
        mockAxios.get.mockResolvedValueOnce({ data: { status: 'ZERO_RESULTS' } });
        const result = await locationUtils.getUtcOffset('NowhereCity');
        
        expect(result.error).toBe(true);
        expect(result.errorType).toContain('Geocoding failed');
      });

      it('should fallback to location name when formatted_address is missing', async () => {
        mockAxios.get
          .mockResolvedValueOnce({
            data: {
              status: 'OK',
              results: [{
                geometry: { location: { lat: 35.6762, lng: 139.6503 } }
                // formatted_address is missing
              }]
            }
          })
          .mockResolvedValueOnce(mockTimezoneResponse);

        const result = await locationUtils.getUtcOffset('TokyoCityNoAddress');
        
        expect(result.error).toBe(false);
        expect(result.placeName).toBe('TokyoCityNoAddress');
      });
    });
  });
});
