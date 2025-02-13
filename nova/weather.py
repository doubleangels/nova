import interactions

from main import logger, PIRATEWEATHER_API_KEY, GOOGLE_API_KEY

class WeatherExtension(interactions.Extension):
    async def get_coordinates(self, city: str):
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

    @interactions.slash_command(name="weather", description="Get the current weather for a city.")
    @interactions.slash_option(
        name="city",
        description="Enter the city name.",
        required=True,
        opt_type=interactions.OptionType.STRING
    )
    async def weather_search(self, ctx: interactions.ComponentContext, city: str):
        """
        Fetches the current weather and 3-day forecast from PirateWeather using city coordinates.
        """
        try:
            await ctx.defer()

            logger.debug(f"Received weather command from user: {ctx.author.id} (User: {ctx.author.username})")
            logger.debug(f"User input for city: '{city}'")

            # Get coordinates
            lat, lon = await get_coordinates(city)
            if lat is None or lon is None:
                logger.warning(f"Failed to get coordinates for '{city}'.")
                await ctx.send(f"Could not find the location for '{city}'. Try another city.")
                return
            
            # Capitalize city name
            city = city.title()
            logger.debug(f"Formatted city name: '{city}' (Lat: {lat}, Lon: {lon})")

            # PirateWeather API request
            url = f"https://api.pirateweather.net/forecast/{PIRATEWEATHER_API_KEY}/{lat},{lon}"
            params = {"units": "si"}  # SI for Celsius
            logger.debug(f"Making API request to: {url} with params {params}")

            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()

                        # Log the full API response for debugging
                        logger.debug(f"Received weather data: {json.dumps(data, indent=2)}")

                        currently = data["currently"]
                        daily = data["daily"]["data"]

                        # Extract current weather data
                        weather = currently.get("summary", "Unknown")
                        temp_c = currently.get("temperature", 0)
                        temp_f = round((temp_c * 9/5) + 32, 1)
                        feels_like_c = currently.get("apparentTemperature", 0)
                        feels_like_f = round((feels_like_c * 9/5) + 32, 1)
                        humidity = currently.get("humidity", 0) * 100
                        wind_speed = currently.get("windSpeed", 0)
                        uv_index = currently.get("uvIndex", "N/A")
                        visibility = currently.get("visibility", "N/A")
                        pressure = currently.get("pressure", "N/A")
                        dew_point_c = currently.get("dewPoint", "N/A")
                        dew_point_f = round((dew_point_c * 9/5) + 32, 1) if isinstance(dew_point_c, (int, float)) else "N/A"
                        cloud_cover = currently.get("cloudCover", 0) * 100
                        precip_intensity = currently.get("precipIntensity", 0)
                        precip_prob = currently.get("precipProbability", 0) * 100

                        # Extract 3-day forecast
                        forecast_text = ""
                        for i in range(3):
                            day = daily[i]
                            day_summary = day.get("summary", "No data")
                            high_c = day.get("temperatureHigh", "N/A")
                            high_f = round((high_c * 9/5) + 32, 1) if isinstance(high_c, (int, float)) else "N/A"
                            low_c = day.get("temperatureLow", "N/A")
                            low_f = round((low_c * 9/5) + 32, 1) if isinstance(low_c, (int, float)) else "N/A"
                            forecast_text += f"**Day {i+1}:** {day_summary}\n🌡 High: {high_c}°C / {high_f}°F, Low: {low_c}°C / {low_f}°F\n\n"

                        # Log extracted weather data
                        logger.debug(f"Extracted weather data for {city}: Temp {temp_c}°C, Feels Like {feels_like_c}°C, Humidity {humidity}%")

                        # Create embed
                        embed = interactions.Embed(
                            title=f"Weather in {city}",
                            description=f"**{weather}**",
                            color=0xFF6E42
                        )
                        embed.add_field(name="🌍 Location", value=f"📍 {city}\n📍 Lat: {lat}, Lon: {lon}", inline=False)
                        embed.add_field(name="🌡 Temperature", value=f"{temp_c}°C / {temp_f}°F", inline=True)
                        embed.add_field(name="🤔 Feels Like", value=f"{feels_like_c}°C / {feels_like_f}°F", inline=True)
                        embed.add_field(name="💧 Humidity", value=f"{humidity}%", inline=True)
                        embed.add_field(name="💨 Wind Speed", value=f"{wind_speed} m/s", inline=True)
                        embed.add_field(name="🌞 UV Index", value=f"{uv_index}", inline=True)
                        embed.add_field(name="👀 Visibility", value=f"{visibility} km", inline=True)
                        embed.add_field(name="🛰 Pressure", value=f"{pressure} hPa", inline=True)
                        embed.add_field(name="🌫 Dew Point", value=f"{dew_point_c}°C / {dew_point_f}°F", inline=True)
                        embed.add_field(name="☁ Cloud Cover", value=f"{cloud_cover}%", inline=True)
                        embed.add_field(name="🌧 Precipitation", value=f"{precip_intensity} mm/hr", inline=True)
                        embed.add_field(name="🌧 Precip. Probability", value=f"{precip_prob}%", inline=True)

                        # Add forecast
                        embed.add_field(name="📅 3-Day Forecast", value=forecast_text, inline=False)
                        embed.set_footer(text="Powered by PirateWeather")

                        await ctx.send(embed=embed)
                    else:
                        logger.warning(f"PirateWeather API error: {response.status}")
                        await ctx.send(f"Error: PirateWeather API returned status code {response.status}.")
        except Exception as e:
            logger.exception(f"Error in /weather command: {e}")
            await ctx.send("An unexpected error occurred. Please try again later.", ephemeral=True)