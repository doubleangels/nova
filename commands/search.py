import json
import datetime
import logging
import aiohttp
from interactions import slash_command, slash_option, OptionType, ComponentContext
from config import GOOGLE_API_KEY, SEARCH_ENGINE_ID, IMAGE_SEARCH_ENGINE_ID, OMDB_API_KEY
from logging_setup import logger

@slash_command(name="google", description="Search Google and return top results.")
@slash_option(name="query", description="Search query", required=True, opt_type=OptionType.STRING)
@slash_option(name="results", description="Number of results (1-10)", required=False, opt_type=OptionType.INTEGER)
async def google_search(ctx: ComponentContext, query: str, results: int = 5):
    try:
        await ctx.defer()
        formatted_query = query.title()
        results = max(1, min(results, 10))
        search_url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": SEARCH_ENGINE_ID,
            "q": query,
            "num": results
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            title = item.get("title", "No Title")
                            link = item.get("link", "No Link")
                            snippet = item.get("snippet", "No Description")
                            embed = {
                                "title": f"🔍 {title}",
                                "description": f"📜 {snippet}\n🔗 [Read More]({link})",
                                "color": 0x1A73E8,
                                "footer": {"text": "Powered by Google Search"}
                            }
                            embeds.append(embed)
                        await ctx.send(embeds=embeds)
                    else:
                        await ctx.send(f"❌ No results found for **{formatted_query}**.")
                else:
                    await ctx.send(f"⚠️ Error: Google API returned status {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /google command: {e}")
        await ctx.send("⚠️ An unexpected error occurred.", ephemeral=True)

@slash_command(name="googleimage", description="Search Google Images and return top results.")
@slash_option(name="query", description="Image search query", required=True, opt_type=OptionType.STRING)
@slash_option(name="results", description="Number of results (1-10)", required=False, opt_type=OptionType.INTEGER)
async def google_image_search(ctx: ComponentContext, query: str, results: int = 5):
    try:
        await ctx.defer()
        formatted_query = query.title()
        results = max(1, min(results, 10))
        search_url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": IMAGE_SEARCH_ENGINE_ID,
            "q": query,
            "searchType": "image",
            "num": results
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            title = item.get("title", "No Title")
                            image_link = item.get("link", "")
                            embed = {
                                "title": f"🖼️ {title}",
                                "description": f"🔗 [View Image]({image_link})",
                                "color": 0x1A73E8,
                                "image": {"url": image_link},
                                "footer": {"text": "Powered by Google Image Search"}
                            }
                            embeds.append(embed)
                        await ctx.send(embeds=embeds)
                    else:
                        await ctx.send(f"❌ No images found for **{formatted_query}**.")
                else:
                    await ctx.send(f"⚠️ Error: Google API returned status {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /googleimage command: {e}")
        await ctx.send("⚠️ An unexpected error occurred.", ephemeral=True)

@slash_command(name="youtube", description="Search YouTube for a video.")
@slash_option(name="query", description="Video search query", required=True, opt_type=OptionType.STRING)
async def youtube_video_search(ctx: ComponentContext, query: str):
    try:
        await ctx.defer()
        formatted_query = query.title()
        search_url = "https://www.googleapis.com/youtube/v3/search"
        params = {
            "key": GOOGLE_API_KEY,
            "part": "snippet",
            "q": query,
            "type": "video",
            "maxResults": 1
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if "items" in data and data["items"]:
                        item = data["items"][0]
                        video_id = item["id"].get("videoId", "")
                        snippet = item["snippet"]
                        title = snippet.get("title", "No Title")
                        description = snippet.get("description", "No Description")
                        thumbnail = snippet.get("thumbnails", {}).get("high", {}).get("url", "")
                        video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else "N/A"
                        embed = {
                            "title": f"🎬 {title}",
                            "description": f"📜 {description}",
                            "url": video_url,
                            "color": 0xFF0000,
                            "fields": [{"name": "🔗 Watch on YouTube", "value": f"[Click Here]({video_url})", "inline": False}],
                            "thumbnail": {"url": thumbnail},
                            "footer": {"text": "Powered by YouTube Data API"}
                        }
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send(f"❌ No video results found for **{formatted_query}**.")
                else:
                    await ctx.send(f"⚠️ Error: YouTube API returned status {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /youtube command: {e}")
        await ctx.send("⚠️ An unexpected error occurred.", ephemeral=True)

@slash_command(name="wikipedia", description="Search Wikipedia for an article.")
@slash_option(name="query", description="Topic to search", required=True, opt_type=OptionType.STRING)
async def wikipedia_search(ctx: ComponentContext, query: str):
    try:
        await ctx.defer()
        formatted_query = query.title()
        search_url = "https://en.wikipedia.org/w/api.php"
        params = {
            "action": "query",
            "format": "json",
            "list": "search",
            "srsearch": query,
            "utf8": 1
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("query", {}).get("search"):
                        top_result = data["query"]["search"][0]
                        title = top_result.get("title", "No Title")
                        snippet = top_result.get("snippet", "No snippet available.")
                        snippet = snippet.replace("<span class=\"searchmatch\">", "**").replace("</span>", "**")
                        page_id = top_result.get("pageid")
                        wiki_url = f"https://en.wikipedia.org/?curid={page_id}"
                        embed = {
                            "title": f"📖 {title}",
                            "description": f"📜 {snippet}",
                            "url": wiki_url,
                            "color": 0xFFFFFF,
                            "fields": [{"name": "🔗 Wikipedia Link", "value": f"[Click Here]({wiki_url})", "inline": False}],
                            "footer": {"text": "Powered by Wikipedia API"}
                        }
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send(f"❌ No results found for **{formatted_query}**.")
                else:
                    await ctx.send(f"⚠️ Error: Wikipedia API returned status {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /wikipedia command: {e}")
        await ctx.send("⚠️ An unexpected error occurred.", ephemeral=True)

@slash_command(name="imdb", description="Search for a movie or TV show on IMDB.")
@slash_option(name="title", description="Movie or TV show title", required=True, opt_type=OptionType.STRING)
async def imdb_search(ctx: ComponentContext, title: str):
    try:
        await ctx.defer()
        formatted_title = title.title()
        search_url = "http://www.omdbapi.com/"
        params = {"t": title, "apikey": OMDB_API_KEY}
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("Response") == "True":
                        title_val = data.get("Title", "Unknown")
                        year = data.get("Year", "Unknown")
                        genre = data.get("Genre", "Unknown")
                        imdb_rating = data.get("imdbRating", "N/A")
                        plot = data.get("Plot", "No plot available.")
                        poster = data.get("Poster", None)
                        imdb_id = data.get("imdbID", None)
                        imdb_link = f"https://www.imdb.com/title/{imdb_id}" if imdb_id else "N/A"
                        embed = {
                            "title": f"🎬 {title_val} ({year})",
                            "description": f"📜 {plot}",
                            "color": 0xFFD700,
                            "fields": [
                                {"name": "🎭 Genre", "value": genre, "inline": True},
                                {"name": "⭐ IMDB Rating", "value": imdb_rating, "inline": True},
                                {"name": "🔗 IMDB Link", "value": f"[Click Here]({imdb_link})", "inline": False}
                            ],
                            "footer": {"text": "Powered by OMDb API"}
                        }
                        if poster and poster != "N/A":
                            embed["thumbnail"] = {"url": poster}
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send(f"❌ No results found for **{formatted_title}**.")
                else:
                    await ctx.send(f"⚠️ Error: OMDb API returned status {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /imdb command: {e}")
        await ctx.send("⚠️ An unexpected error occurred.", ephemeral=True)

@slash_command(name="define", description="Get the definition and synonyms of a word.")
@slash_option(name="word", description="Word to define", required=True, opt_type=OptionType.STRING)
async def dictionary_search(ctx: ComponentContext, word: str):
    try:
        await ctx.defer()
        word = word.lower()
        url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{word}"
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    data = await response.json()
                    if isinstance(data, list) and data:
                        entry = data[0]
                        meanings = entry.get("meanings", [])
                        if meanings:
                            definitions = meanings[0].get("definitions", [])
                            definition_text = definitions[0].get("definition", "No definition found.") if definitions else "No definition available."
                            synonyms = meanings[0].get("synonyms", [])
                            synonyms_text = ", ".join(synonyms[:5]) if synonyms else "No synonyms available."
                            embed = {
                                "title": f"📖 Definition of {word.capitalize()}",
                                "description": f"📜 {definition_text}",
                                "color": 0xD3D3D3,
                                "fields": [{"name": "🟢 Synonyms", "value": synonyms_text, "inline": False}],
                                "footer": {"text": "Powered by Free Dictionary API"}
                            }
                            await ctx.send(embed=embed)
                        else:
                            await ctx.send(f"❌ No definition found for **{word}**.")
                    else:
                        await ctx.send(f"❌ No definition found for **{word}**.")
                else:
                    await ctx.send(f"⚠️ Error: Dictionary API returned status {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /define command: {e}")
        await ctx.send("⚠️ An unexpected error occurred.", ephemeral=True)

@slash_command(name="weather", description="Get current weather for a place.")
@slash_option(name="place", description="Place name", required=True, opt_type=OptionType.STRING)
async def weather_search(ctx: ComponentContext, place: str):
    try:
        await ctx.defer()
        # Helper function to get coordinates from Google Geocoding API.
        async def get_coordinates(city: str):
            geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
            params = {"address": city, "key": GOOGLE_API_KEY}
            async with aiohttp.ClientSession() as session:
                async with session.get(geocode_url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get("results"):
                            location = data["results"][0]["geometry"]["location"]
                            return location["lat"], location["lng"]
                        else:
                            return None, None
                    else:
                        return None, None
        lat, lon = await get_coordinates(place)
        if lat is None or lon is None:
            await ctx.send(f"Could not find location for {place}.")
            return
        place_title = place.title()
        url = f"https://api.pirateweather.net/forecast/{OMDB_API_KEY}/{lat},{lon}"
        params = {"units": "si"}
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    currently = data["currently"]
                    daily = data["daily"]["data"]
                    weather = currently.get("summary", "Unknown")
                    temp_c = currently.get("temperature", 0)
                    temp_f = round((temp_c * 9/5) + 32, 1)
                    forecast_text = ""
                    for i in range(3):
                        day = daily[i]
                        day_summary = day.get("summary", "No data")
                        high_c = day.get("temperatureHigh", "N/A")
                        high_f = round((high_c * 9/5) + 32, 1) if isinstance(high_c, (int, float)) else "N/A"
                        low_c = day.get("temperatureLow", "N/A")
                        low_f = round((low_c * 9/5) + 32, 1) if isinstance(low_c, (int, float)) else "N/A"
                        forecast_text += f"**Day {i+1}:** {day_summary}\n🌡 High: {high_c}°C / {high_f}°F, Low: {low_c}°C / {low_f}°F\n\n"
                    embed = {
                        "title": f"Weather in {place_title}",
                        "description": f"**{weather}**",
                        "color": 0xFF6E42,
                        "fields": [
                            {"name": "🌡 Temperature", "value": f"{temp_c}°C / {temp_f}°F", "inline": True},
                            {"name": "📅 3-Day Forecast", "value": forecast_text, "inline": False}
                        ],
                        "footer": {"text": "Powered by PirateWeather"}
                    }
                    await ctx.send(embed=embed)
                else:
                    await ctx.send(f"Error: PirateWeather API returned status {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /weather command: {e}")
        await ctx.send("An unexpected error occurred.", ephemeral=True)

@slash_command(name="timedifference", description="Get time difference between two places.")
@slash_option(name="place1", description="First city", required=True, opt_type=OptionType.STRING)
@slash_option(name="place2", description="Second city", required=True, opt_type=OptionType.STRING)
async def time_difference(ctx: ComponentContext, place1: str, place2: str):
    try:
        await ctx.defer()
        async def get_utc_offset(city):
            geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
            timezone_url = "https://maps.googleapis.com/maps/api/timezone/json"
            async with aiohttp.ClientSession() as session:
                async with session.get(geocode_url, params={"address": city, "key": GOOGLE_API_KEY}) as response:
                    geo_data = await response.json()
                    if geo_data.get("results"):
                        location = geo_data["results"][0]["geometry"]["location"]
                        lat, lng = location["lat"], location["lng"]
                    else:
                        return None
                timestamp = int(datetime.datetime.now().timestamp())
                async with session.get(timezone_url, params={"location": f"{lat},{lng}", "timestamp": timestamp, "key": GOOGLE_API_KEY}) as response:
                    tz_data = await response.json()
                    if tz_data.get("status") == "OK":
                        raw_offset = tz_data["rawOffset"] / 3600
                        dst_offset = tz_data["dstOffset"] / 3600
                        return raw_offset + dst_offset
                    else:
                        return None
        offset1 = await get_utc_offset(place1)
        offset2 = await get_utc_offset(place2)
        if offset1 is None or offset2 is None:
            await ctx.send(f"❌ Could not retrieve timezones for {place1} or {place2}.")
            return
        diff = abs(offset1 - offset2)
        await ctx.send(f"⏳ Time difference between {place1.title()} and {place2.title()} is {diff} hours.")
    except Exception as e:
        logger.exception(f"Error in /timedifference command: {e}")
        await ctx.send("⚠️ An unexpected error occurred.", ephemeral=True)

@slash_command(name="urban", description="Search Urban Dictionary for a term.")
@slash_option(name="query", description="Term to search", required=True, opt_type=OptionType.STRING)
async def urban_dictionary_search(ctx: ComponentContext, query: str):
    try:
        await ctx.defer()
        search_url = "https://api.urbandictionary.com/v0/define"
        params = {"term": query}
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("list"):
                        top_result = data["list"][0]
                        word = top_result.get("word", "No Word")
                        definition = top_result.get("definition", "No Definition").replace("\r\n", "\n")
                        example = top_result.get("example", "").replace("\r\n", "\n") or "No example available."
                        thumbs_up = top_result.get("thumbs_up", 0)
                        thumbs_down = top_result.get("thumbs_down", 0)
                        embed = {
                            "title": f"📖 Definition: {word}",
                            "description": definition,
                            "color": 0x1D2439,
                            "fields": [
                                {"name": "📝 Example", "value": example, "inline": False},
                                {"name": "👍 Thumbs Up", "value": str(thumbs_up), "inline": True},
                                {"name": "👎 Thumbs Down", "value": str(thumbs_down), "inline": True},
                            ],
                            "footer": {"text": "Powered by Urban Dictionary"}
                        }
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send("⚠️ No definitions found. Try refining your query.")
                else:
                    await ctx.send(f"⚠️ Error: Urban Dictionary API returned status {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /urban command: {e}")
        await ctx.send("⚠️ An unexpected error occurred.", ephemeral=True)

@slash_command(name="mal", description="Search for an anime on MyAnimeList.")
@slash_option(name="title", description="Anime title", required=True, opt_type=OptionType.STRING)
async def mal_search(ctx: ComponentContext, title: str):
    try:
        await ctx.defer()
        formatted_title = title.title()
        search_url = f"https://api.myanimelist.net/v2/anime?q={title}&limit=1"
        import os
        headers = {"X-MAL-CLIENT-ID": os.getenv("MAL_CLIENT_ID")}
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if "data" in data and data["data"]:
                        anime = data["data"][0]["node"]
                        anime_id = anime.get("id")
                        anime_title = anime.get("title", "Unknown")
                        image_url = anime.get("main_picture", {}).get("medium")
                        mal_link = f"https://myanimelist.net/anime/{anime_id}" if anime_id else "N/A"
                        details_url = f"https://api.myanimelist.net/v2/anime/{anime_id}?fields=id,title,synopsis,mean,genres,start_date"
                        async with session.get(details_url, headers=headers) as details_response:
                            if details_response.status == 200:
                                details_data = await details_response.json()
                                synopsis = details_data.get("synopsis", "No synopsis available.")
                                rating = details_data.get("mean", "N/A")
                                genres = ", ".join([g["name"] for g in details_data.get("genres", [])]) or "Unknown"
                                release_date = details_data.get("start_date", "Unknown")
                                embed = {
                                    "title": f"📺 {anime_title}",
                                    "description": f"📜 {synopsis}",
                                    "color": 0x2E51A2,
                                    "fields": [
                                        {"name": "🎭 Genre", "value": genres, "inline": True},
                                        {"name": "⭐ MAL Rating", "value": rating, "inline": True},
                                        {"name": "📅 Release Date", "value": release_date, "inline": True},
                                        {"name": "🔗 MAL Link", "value": f"[Click Here]({mal_link})", "inline": False},
                                    ],
                                    "footer": {"text": "Powered by MyAnimeList API"}
                                }
                                if image_url:
                                    embed["thumbnail"] = {"url": image_url}
                                await ctx.send(embed=embed)
                            else:
                                await ctx.send("⚠️ Error fetching additional anime details.")
                    else:
                        await ctx.send(f"❌ No anime found for **{formatted_title}**.")
                else:
                    await ctx.send(f"⚠️ Error: MAL API returned status {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /mal command: {e}")
        await ctx.send("⚠️ An unexpected error occurred.", ephemeral=True)
