import aiohttp
import json

async def get_coordinates(city: str):
    """
    Fetch latitude and longitude for a given city using Google Maps Geocoding API.
    """
    try:
        geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {"address": city, "key": GOOGLE_API_KEY}

        async with aiohttp.ClientSession() as session:
            async with session.get(geocode_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    logger.debug(f"Google Geocoding API response: {json.dumps(data, indent=2)}")

                    if data.get("results"):
                        location = data["results"][0]["geometry"]["location"]
                        lat, lon = location["lat"], location["lng"]
                        logger.debug(f"Retrieved coordinates for {city}: ({lat}, {lon})")
                        return lat, lon
                    else:
                        logger.warning(f"No results found for city: {city}")
                else:
                    logger.error(f"Google Geocoding API error: Status {response.status}")
    except Exception as e:
        logger.exception(f"Error fetching city coordinates: {e}")

    return None, None