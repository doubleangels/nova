import asyncio
import datetime
import io
import json
import logging
import time
import uuid

import aiohttp
import pytz
import numpy as np
from PIL import Image

import interactions
from interactions import Embed, File, OptionType, Permissions
from nova.config import (
    GOOGLE_API_KEY,
    SEARCH_ENGINE_ID,
    IMAGE_SEARCH_ENGINE_ID,
    OMDB_API_KEY,
    PIRATEWEATHER_API_KEY,
    MAL_CLIENT_ID,
)
import nova.database as db
import nova.reminders as reminders
from nova.bot_client import bot

logger = logging.getLogger("Nova")

# -------------------------------------------------------------------
# /reminder Command
# -------------------------------------------------------------------
@bot.slash_command(name="reminder", description="Setup and check the status of bump and boop reminders.")
@interactions.slash_option(
    name="channel",
    description="Channel to send reminders in (leave empty to check status)",
    required=False,
    opt_type=OptionType.CHANNEL,
)
@interactions.slash_option(
    name="role",
    description="Role to ping in reminders (leave empty to check status)",
    required=False,
    opt_type=OptionType.ROLE,
)
async def reminder(ctx: interactions.ComponentContext, channel=None, role: interactions.Role = None):
    try:
        if channel and role:
            if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
                logger.warning(f"Unauthorized /reminder setup attempt by {ctx.author.username} ({ctx.author.id})")
                await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
                return
            db.set_value("reminder_channel", channel.id)
            db.set_value("role", role.id)
            await ctx.send(f"✅ Reminder setup complete! Reminders will be sent in <#{channel.id}> and the role to be pinged is <@&{role.id}>.")
            return

        channel_id = db.get_value("reminder_channel")
        role_id = db.get_value("role")
        channel_str = f"<#{channel_id}>" if channel_id else "Not set!"
        role_str = f"<@&{role_id}>" if role_id else "Not set!"
        reminders_info = []
        for reminder_key in ["disboard", "discadia", "dsme", "unfocused"]:
            data = db.get_reminder_data(reminder_key)
            time_str = reminders.calculate_remaining_time(data.get("scheduled_time")) if data else "Not set!"
            reminders_info.append(f"⏳ {reminder_key.capitalize()}: {time_str}")
        summary = (
            f"📌 Reminder Status:\n"
            f"Channel: {channel_str}\n"
            f"Role: {role_str}\n\n" +
            "\n".join(reminders_info)
        )
        await ctx.send(summary)
    except Exception as e:
        logger.exception(f"Error in /reminder command: {e}")
        await ctx.send("⚠️ An error occurred while processing your request.", ephemeral=True)


# -------------------------------------------------------------------
# /fix Command
# -------------------------------------------------------------------
@bot.slash_command(name="fix", description="Runs the logic to add service data to the database under the key name of 'fix'.")
@interactions.slash_option(
    name="service",
    description="Service to generate fix for in the database",
    required=True,
    opt_type=OptionType.STRING,
)
async def fix_command(ctx: interactions.ComponentContext, service: str):
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        logger.warning(f"Unauthorized /fix attempt by {ctx.author.username} ({ctx.author.id})")
        return
    try:
        await ctx.defer()
        logger.debug(f"Received /fix command from {ctx.author.username} ({ctx.author.id}) for service: {service}")
        service_delays = {
            "disboard": 7200,   # 2 hours
            "dsme": 43200,      # 12 hours
            "unfocused": 30600, # 6 hours
            "discadia": 43200   # 12 hours
        }
        if service not in service_delays:
            logger.warning(f"Invalid service name provided: {service}")
            await ctx.send("⚠️ Invalid service name provided. Please use one of: disboard, dsme, unfocused, discadia.", ephemeral=True)
            return
        seconds = service_delays[service]
        reminder_id = str(uuid.uuid4())
        scheduled_time = (datetime.datetime.now(tz=pytz.UTC) + datetime.timedelta(seconds=seconds)).isoformat()
        db.set_reminder_data(service, True, scheduled_time, reminder_id)
        logger.debug(f"Fix logic applied for service '{service}'.")
        await ctx.send(f"✅ Fix logic successfully applied for **{service}**!")
    except Exception as e:
        logger.exception(f"Error in /fix command: {e}")
        await ctx.send("⚠️ An error occurred while applying fix logic. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /resetreminders Command
# -------------------------------------------------------------------
@bot.slash_command(name="resetreminders", description="Reset all reminders in the database to default values.")
async def reset_reminders(ctx: interactions.ComponentContext):
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /resetreminders attempt by {ctx.author.username} ({ctx.author.id})")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return
    try:
        await ctx.defer()
        reminder_keys = ["disboard", "dsme", "unfocused", "discadia"]
        for key in reminder_keys:
            db.set_reminder_data(key, False, None, None)
            logger.debug(f"Reset reminder data for key: {key}")
        await ctx.send("✅ All reminders have been reset to default values.")
    except Exception as e:
        logger.exception(f"Error in /resetreminders command: {e}")
        await ctx.send("⚠️ An error occurred while resetting reminders. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /mutemode Command
# -------------------------------------------------------------------
@bot.slash_command(name="mutemode", description="Toggle auto-kicking of users who don't send a message within a time limit.")
@interactions.slash_option(
    name="enabled",
    description="Enable or disable mute mode",
    required=True,
    opt_type=OptionType.BOOLEAN,
)
@interactions.slash_option(
    name="time",
    description="Time limit in hours before a silent user is kicked (Default: 2)",
    required=False,
    opt_type=OptionType.INTEGER,
)
async def toggle_mute_mode(ctx: interactions.ComponentContext, enabled: bool, time: int = 2):
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /mutemode attempt by {ctx.author.username} ({ctx.author.id})")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return
    try:
        db.set_value("mute_mode", enabled)
        db.set_value("mute_mode_kick_time_hours", time)
        response_message = (
            f"🔇 Mute mode has been enabled. New users must send a message within {time} hours or be kicked."
            if enabled
            else "🔇 Mute mode has been disabled."
        )
        await ctx.send(response_message)
    except Exception as e:
        logger.exception(f"Error in /mutemode command: {e}")
        await ctx.send("⚠️ An error occurred while toggling mute mode. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /testmessage Command
# -------------------------------------------------------------------
@bot.slash_command(name="testmessage", description="Send a test message to the reminder channel.")
async def test_reminders(ctx: interactions.ComponentContext):
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /testmessage attempt by {ctx.author.username} ({ctx.author.id})")
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return
    try:
        role_id = db.get_value("role")
        if not role_id:
            await ctx.send("⚠️ No role has been set up for reminders.", ephemeral=True)
            return
        await ctx.send(f"🔔 <@&{role_id}> This is a test reminder message!")
    except Exception as e:
        logger.exception(f"Error in /testmessage command: {e}")
        await ctx.send("⚠️ Could not send test message. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /dev Command
# -------------------------------------------------------------------
@bot.slash_command(name="dev", description="Maintain developer tag.")
async def dev(ctx: interactions.ComponentContext):
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return
    try:
        await ctx.send("🛠️ Developer tag maintained!")
    except Exception as e:
        logger.exception(f"Error in /dev command: {e}")
        await ctx.send("⚠️ An error occurred while maintaining the developer tag. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /source Command
# -------------------------------------------------------------------
@bot.slash_command(name="source", description="Get links for the bot's resources.")
async def source(ctx: interactions.ComponentContext):
    try:
        embed = Embed(
            title="📜 Bot Resources",
            description="Here are the links for the bot's resources:",
            color=0x00ff00,
        )
        embed.add_field(name="🖥️ GitHub Repository", value="[Click Here](https://github.com/doubleangels/Nova)", inline=False)
        embed.add_field(name="🗄️ Supabase Database", value="[Click Here](https://supabase.com/dashboard/project/amietgblnpazkunprnxo/editor/29246?schema=public)", inline=False)
        await ctx.send(embeds=[embed])
    except Exception as e:
        logger.exception(f"Error in /source command: {e}")
        await ctx.send("⚠️ An error occurred while processing your request.", ephemeral=True)


# -------------------------------------------------------------------
# /backupmode Command
# -------------------------------------------------------------------
@bot.slash_command(name="backupmode", description="Configure and toggle backup mode for new members.")
@interactions.slash_option(
    name="channel",
    description="Channel to send welcome messages for new members (leave empty to check status)",
    required=False,
    opt_type=OptionType.CHANNEL,
)
@interactions.slash_option(
    name="role",
    description="Role to assign to new members (leave empty to check status)",
    required=False,
    opt_type=OptionType.ROLE,
)
@interactions.slash_option(
    name="enabled",
    description="Enable (true) or disable (false) auto-role assignment (leave empty to check status)",
    required=False,
    opt_type=OptionType.BOOLEAN,
)
async def backupmode(ctx: interactions.ComponentContext, channel=None, role: interactions.Role = None, enabled: bool = None):
    try:
        if channel or role or enabled is not None:
            if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
                await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
                return
            if channel:
                db.set_value("backup_mode_channel", channel.id)
            if role:
                db.set_value("backup_mode_id", role.id)
            if enabled is not None:
                db.set_value("backup_mode_enabled", enabled)
            await ctx.send(
                f"🔄 Backup Mode Configured!\n"
                f"Welcome messages will be sent in {f'<#{channel.id}>' if channel else 'Not changed'}\n"
                f"New members will be assigned the role: {f'<@&{role.id}>' if role else 'Not changed'}\n"
                f"Auto-role assignment: {'Enabled' if enabled else 'Disabled' if enabled is not None else 'Not changed'}"
            )
            return
        channel_id = db.get_value("backup_mode_channel")
        role_id = db.get_value("backup_mode_id")
        enabled_status = db.get_value("backup_mode_enabled")
        channel_str = f"📢 <#{channel_id}>" if channel_id else "Not set!"
        role_str = f"🎭 <@&{role_id}>" if role_id else "Not set!"
        enabled_str = "✅ Enabled" if enabled_status else "❌ Disabled"
        summary = (
            f"📌 Backup Mode Status:\n"
            f"Channel: {channel_str}\n"
            f"Role: {role_str}\n"
            f"Auto-role assignment: {enabled_str}"
        )
        await ctx.send(summary)
    except Exception as e:
        logger.exception(f"Error in /backupmode command: {e}")
        await ctx.send("⚠️ An error occurred while processing your request.", ephemeral=True)


# -------------------------------------------------------------------
# /trollmode Command
# -------------------------------------------------------------------
@bot.slash_command(name="trollmode", description="Toggle kicking of accounts younger than a specified age.")
@interactions.slash_option(
    name="enabled",
    description="Enable or disable troll mode",
    required=True,
    opt_type=OptionType.BOOLEAN,
)
@interactions.slash_option(
    name="age",
    description="Minimum account age in days (Default: 30)",
    required=False,
    opt_type=OptionType.INTEGER,
)
async def trollmode(ctx: interactions.ComponentContext, enabled: bool, age: int = 30):
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission to use this command.", ephemeral=True)
        return
    try:
        db.set_value("troll_mode", enabled)
        db.set_value("troll_mode_account_age", age)
        response_message = f"👹 Troll mode has been enabled. Minimum account age: {age} days." if enabled else "👹 Troll mode has been disabled."
        await ctx.send(response_message)
    except Exception as e:
        logger.exception(f"Error in /trollmode command: {e}")
        await ctx.send("⚠️ An error occurred while toggling troll mode. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /google Command
# -------------------------------------------------------------------
@bot.slash_command(name="google", description="Search Google and return the top results.")
@interactions.slash_option(
    name="query",
    description="What do you want to search for?",
    required=True,
    opt_type=OptionType.STRING,
)
@interactions.slash_option(
    name="results",
    description="How many results do you want? (1-10)",
    required=False,
    opt_type=OptionType.INTEGER,
)
async def google_search(ctx: interactions.ComponentContext, query: str, results: int = 1):
    try:
        await ctx.defer()
        formatted_query = query.title()
        results = max(1, min(results, 10))
        search_url = "https://www.googleapis.com/customsearch/v1"
        params = {
            "key": GOOGLE_API_KEY,
            "cx": SEARCH_ENGINE_ID,
            "q": query,
            "num": results,
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if "items" in data and data["items"]:
                        embeds = []
                        for item in data["items"]:
                            title = item.get("title", "No Title Found")
                            link = item.get("link", "No Link Found")
                            snippet = item.get("snippet", "No Description Found")
                            embed = Embed(
                                title=f"🔍 {title}",
                                description=f"📜 {snippet}\n🔗 [Read More]({link})",
                                color=0x1A73E8,
                            )
                            embed.set_footer(text="Powered by Google Search")
                            embeds.append(embed)
                        await ctx.send(embeds=embeds)
                    else:
                        await ctx.send(f"❌ No search results found for '{formatted_query}'. Try refining your query!")
                else:
                    await ctx.send(f"⚠️ Error: Google API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /google command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /googleimage Command
# -------------------------------------------------------------------
@bot.slash_command(name="googleimage", description="Search Google for images and return the top results.")
@interactions.slash_option(
    name="query",
    description="What images do you want to search for?",
    required=True,
    opt_type=OptionType.STRING,
)
@interactions.slash_option(
    name="results",
    description="How many results do you want? (1-10)",
    required=False,
    opt_type=OptionType.INTEGER,
)
async def google_image_search(ctx: interactions.ComponentContext, query: str, results: int = 1):
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
            "num": results,
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
                            embed = Embed(
                                title=f"🖼️ {title}",
                                description=f"🔗 [View Image]({image_link})",
                                color=0x1A73E8,
                            )
                            embed.set_image(url=image_link)
                            embed.set_footer(text="Powered by Google Image Search")
                            embeds.append(embed)
                        await ctx.send(embeds=embeds)
                    else:
                        await ctx.send(f"❌ No images found for '{formatted_query}'. Try refining your query!")
                else:
                    await ctx.send(f"⚠️ Error: Google API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /googleimage command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /youtube Command
# -------------------------------------------------------------------
@bot.slash_command(name="youtube", description="Search YouTube for videos and return the top result.")
@interactions.slash_option(
    name="query",
    description="What videos do you want to search for?",
    required=True,
    opt_type=OptionType.STRING,
)
async def youtube_video_search(ctx: interactions.ComponentContext, query: str):
    try:
        await ctx.defer()
        formatted_query = query.title()
        search_url = "https://www.googleapis.com/youtube/v3/search"
        params = {
            "key": GOOGLE_API_KEY,
            "part": "snippet",
            "q": query,
            "type": "video",
            "maxResults": 1,
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if "items" in data and data["items"]:
                        item = data["items"][0]
                        video_id = item["id"].get("videoId", "")
                        snippet = item["snippet"]
                        title_res = snippet.get("title", "No Title")
                        description = snippet.get("description", "No Description")
                        thumbnail = snippet.get("thumbnails", {}).get("high", {}).get("url", "")
                        video_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else "N/A"
                        embed = Embed(
                            title=f"🎬 {title_res}",
                            description=f"📜 {description}",
                            url=video_url,
                            color=0xFF0000,
                        )
                        embed.add_field(name="Watch on YouTube", value=f"[Click Here]({video_url})", inline=False)
                        if thumbnail:
                            embed.set_thumbnail(url=thumbnail)
                        embed.set_footer(text="Powered by YouTube Data API")
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send(f"❌ No video results found for '{formatted_query}'. Try another search!")
                else:
                    await ctx.send(f"⚠️ Error: YouTube API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /youtube command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /wikipedia Command
# -------------------------------------------------------------------
@bot.slash_command(name="wikipedia", description="Search Wikipedia for articles and return the top result.")
@interactions.slash_option(
    name="query",
    description="What topic do you want to search for?",
    required=True,
    opt_type=OptionType.STRING,
)
async def wikipedia_search(ctx: interactions.ComponentContext, query: str):
    try:
        await ctx.defer()
        formatted_query = query.title()
        search_url = "https://en.wikipedia.org/w/api.php"
        params = {
            "action": "query",
            "format": "json",
            "list": "search",
            "srsearch": query,
            "utf8": 1,
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    if data.get("query", {}).get("search"):
                        top_result = data["query"]["search"][0]
                        title_res = top_result.get("title", "No Title")
                        snippet = top_result.get("snippet", "No snippet available.").replace("<span class=\"searchmatch\">", "**").replace("</span>", "**")
                        page_id = top_result.get("pageid")
                        wiki_url = f"https://en.wikipedia.org/?curid={page_id}"
                        embed = Embed(
                            title=f"📖 {title_res}",
                            description=f"📜 {snippet}",
                            url=wiki_url,
                            color=0xFFFFFF,
                        )
                        embed.add_field(name="Wikipedia Link", value=f"[Click Here]({wiki_url})", inline=False)
                        embed.set_footer(text="Powered by Wikipedia API")
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send(f"❌ No results found for '{formatted_query}'. Try refining your search!")
                else:
                    await ctx.send(f"⚠️ Error: Wikipedia API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /wikipedia command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /imdb Command
# -------------------------------------------------------------------
@bot.slash_command(name="imdb", description="Search for a movie or TV show on IMDB.")
@interactions.slash_option(
    name="title",
    description="Enter the movie or TV show title.",
    required=True,
    opt_type=OptionType.STRING,
)
async def imdb_search(ctx: interactions.ComponentContext, title: str):
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
                        title_res = data.get("Title", "Unknown")
                        year = data.get("Year", "Unknown")
                        genre = data.get("Genre", "Unknown")
                        imdb_rating = data.get("imdbRating", "N/A")
                        plot = data.get("Plot", "No plot available.")
                        poster = data.get("Poster", None)
                        imdb_id = data.get("imdbID", None)
                        imdb_link = f"https://www.imdb.com/title/{imdb_id}" if imdb_id else "N/A"
                        embed = Embed(
                            title=f"🎬 {title_res} ({year})",
                            description=f"📜 {plot}",
                            color=0xFFD700,
                        )
                        embed.add_field(name="Genre", value=f"{genre}", inline=True)
                        embed.add_field(name="IMDB Rating", value=f"{imdb_rating}", inline=True)
                        embed.add_field(name="IMDB Link", value=f"[Click Here]({imdb_link})", inline=False)
                        if poster and poster != "N/A":
                            embed.set_thumbnail(url=poster)
                        embed.set_footer(text="Powered by OMDb API")
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send(f"❌ No results found for '{formatted_title}'. Try another title!")
                else:
                    await ctx.send(f"⚠️ Error: OMDb API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /imdb command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /define Command
# -------------------------------------------------------------------
@bot.slash_command(name="define", description="Get the definition and synonyms of a word.")
@interactions.slash_option(
    name="word",
    description="Enter the word you want to look up.",
    required=True,
    opt_type=OptionType.STRING,
)
async def dictionary_search(ctx: interactions.ComponentContext, word: str):
    try:
        await ctx.defer()
        word_lower = word.lower()
        url = f"https://api.dictionaryapi.dev/api/v2/entries/en/{word_lower}"
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
                            embed = Embed(
                                title=f"📖 Definition of {word.capitalize()}",
                                description=f"📜 {definition_text}",
                                color=0xD3D3D3,
                            )
                            embed.add_field(name="Synonyms", value=synonyms_text, inline=False)
                            embed.set_footer(text="Powered by Free Dictionary API")
                            await ctx.send(embed=embed)
                        else:
                            await ctx.send(f"❌ No definition found for '{word}'.")
                    else:
                        await ctx.send(f"❌ No definition found for '{word}'.")
                else:
                    await ctx.send(f"⚠️ Error: Dictionary API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /define command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /weather Command
# -------------------------------------------------------------------
@bot.slash_command(name="weather", description="Get the current weather for a city.")
@interactions.slash_option(
    name="city",
    description="Enter the city name.",
    required=True,
    opt_type=OptionType.STRING,
)
async def weather_search(ctx: interactions.ComponentContext, city: str):
    try:
        await ctx.defer()
        async def get_coordinates(city_name: str):
            geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
            params = {"address": city_name, "key": GOOGLE_API_KEY}
            async with aiohttp.ClientSession() as session:
                async with session.get(geocode_url, params=params) as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get("results"):
                            location = data["results"][0]["geometry"]["location"]
                            return location["lat"], location["lng"]
            return None, None

        lat, lon = await get_coordinates(city)
        if lat is None or lon is None:
            await ctx.send(f"Could not find the location for '{city}'. Try another city.")
            return
        city_title = city.title()
        url = f"https://api.pirateweather.net/forecast/{PIRATEWEATHER_API_KEY}/{lat},{lon}"
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
                    forecast_text = ""
                    for i in range(3):
                        day = daily[i]
                        day_summary = day.get("summary", "No data")
                        high_c = day.get("temperatureHigh", "N/A")
                        high_f = round((high_c * 9/5) + 32, 1) if isinstance(high_c, (int, float)) else "N/A"
                        low_c = day.get("temperatureLow", "N/A")
                        low_f = round((low_c * 9/5) + 32, 1) if isinstance(low_c, (int, float)) else "N/A"
                        forecast_text += f"**Day {i+1}:** {day_summary}\n🌡 High: {high_c}°C / {high_f}°F, Low: {low_c}°C / {low_f}°F\n\n"
                    embed = Embed(
                        title=f"Weather in {city_title}",
                        description=f"**{weather}**",
                        color=0xFF6E42,
                    )
                    embed.add_field(name="Location", value=f"{city_title}\nLat: {lat}, Lon: {lon}", inline=False)
                    embed.add_field(name="Temperature", value=f"{temp_c}°C / {temp_f}°F", inline=True)
                    embed.add_field(name="Feels Like", value=f"{feels_like_c}°C / {feels_like_f}°F", inline=True)
                    embed.add_field(name="Humidity", value=f"{humidity}%", inline=True)
                    embed.add_field(name="Wind Speed", value=f"{wind_speed} m/s", inline=True)
                    embed.add_field(name="UV Index", value=f"{uv_index}", inline=True)
                    embed.add_field(name="Visibility", value=f"{visibility} km", inline=True)
                    embed.add_field(name="Pressure", value=f"{pressure} hPa", inline=True)
                    embed.add_field(name="Dew Point", value=f"{dew_point_c}°C / {dew_point_f}°F", inline=True)
                    embed.add_field(name="Cloud Cover", value=f"{cloud_cover}%", inline=True)
                    embed.add_field(name="Precipitation", value=f"{precip_intensity} mm/hr", inline=True)
                    embed.add_field(name="Precip. Probability", value=f"{precip_prob}%", inline=True)
                    embed.add_field(name="3-Day Forecast", value=forecast_text, inline=False)
                    embed.set_footer(text="Powered by PirateWeather")
                    await ctx.send(embed=embed)
                else:
                    await ctx.send(f"Error: PirateWeather API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /weather command: {e}")
        await ctx.send("An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /urban Command
# -------------------------------------------------------------------
@bot.slash_command(name="urban", description="Search Urban Dictionary for definitions.")
@interactions.slash_option(
    name="query",
    description="What term do you want to search for?",
    required=True,
    opt_type=OptionType.STRING,
)
async def urban_dictionary_search(ctx: interactions.ComponentContext, query: str):
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
                        definition = top_result.get("definition", "No Definition Available.").replace("\r\n", "\n")
                        example = top_result.get("example", "").replace("\r\n", "\n") or "No example available."
                        thumbs_up = top_result.get("thumbs_up", 0)
                        thumbs_down = top_result.get("thumbs_down", 0)
                        embed = Embed(
                            title=f"Definition: {word}",
                            description=definition,
                            color=0x1D2439,
                        )
                        embed.add_field(name="Example", value=example, inline=False)
                        embed.add_field(name="👍 Thumbs Up", value=str(thumbs_up), inline=True)
                        embed.add_field(name="👎 Thumbs Down", value=str(thumbs_down), inline=True)
                        embed.set_footer(text="Powered by Urban Dictionary")
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send("⚠️ No definitions found for your query. Try refining it.")
                else:
                    await ctx.send(f"⚠️ Error: Urban Dictionary API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /urban command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /mal Command
# -------------------------------------------------------------------
@bot.slash_command(name="mal", description="Search for an anime on MyAnimeList.")
@interactions.slash_option(
    name="title",
    description="Enter the anime title.",
    required=True,
    opt_type=OptionType.STRING,
)
async def mal_search(ctx: interactions.ComponentContext, title: str):
    try:
        await ctx.defer()
        formatted_title = title.title()
        search_url = f"https://api.myanimelist.net/v2/anime?q={title}&limit=1"
        headers = {"X-MAL-CLIENT-ID": MAL_CLIENT_ID}
        async with aiohttp.ClientSession() as session:
            async with session.get(search_url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    if "data" in data and data["data"]:
                        anime = data["data"][0]["node"]
                        anime_id = anime.get("id", None)
                        title_res = anime.get("title", "Unknown")
                        image_url = anime.get("main_picture", {}).get("medium", None)
                        mal_link = f"https://myanimelist.net/anime/{anime_id}" if anime_id else "N/A"
                        details_url = f"https://api.myanimelist.net/v2/anime/{anime_id}?fields=id,title,synopsis,mean,genres,start_date"
                        async with session.get(details_url, headers=headers) as details_response:
                            if details_response.status == 200:
                                details_data = await details_response.json()
                                synopsis = details_data.get("synopsis", "No synopsis available.")
                                rating = details_data.get("mean", "N/A")
                                genres = ", ".join([g["name"] for g in details_data.get("genres", [])]) or "Unknown"
                                release_date = details_data.get("start_date", "Unknown")
                                embed = Embed(
                                    title=f"{title_res}",
                                    description=f"Synopsis: {synopsis}",
                                    color=0x2E51A2,
                                )
                                embed.add_field(name="Genre", value=genres, inline=True)
                                embed.add_field(name="MAL Rating", value=rating, inline=True)
                                embed.add_field(name="Release Date", value=release_date, inline=True)
                                embed.add_field(name="MAL Link", value=f"[Click Here]({mal_link})", inline=False)
                                if image_url:
                                    embed.set_thumbnail(url=image_url)
                                embed.set_footer(text="Powered by MyAnimeList API")
                                await ctx.send(embed=embed)
                            else:
                                await ctx.send("⚠️ Error fetching additional anime details. Please try again later.")
                    else:
                        await ctx.send(f"❌ No anime found for '{formatted_title}'. Try another title!")
                else:
                    await ctx.send(f"⚠️ Error: MAL API returned status code {response.status}.")
    except Exception as e:
        logger.exception(f"Error in /mal command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /cat Command
# -------------------------------------------------------------------
@bot.slash_command(name="cat", description="Get a random cat picture!")
async def cat_image(ctx: interactions.ComponentContext):
    try:
        await ctx.defer()
        cat_api_url = f"https://cataas.com/cat?timestamp={int(time.time())}"
        async with aiohttp.ClientSession() as session:
            async with session.get(cat_api_url) as response:
                if response.status == 200:
                    image_bytes = await response.read()
                    file_obj = io.BytesIO(image_bytes)
                    file_obj.seek(0)
                    filename = "cat.jpg"
                    file = File(file_name=filename, file=file_obj)
                    embed = Embed(
                        title="Random Cat Picture",
                        description="Here's a cat for you!",
                        color=0xD3D3D3,
                    )
                    embed.set_image(url=f"attachment://{filename}")
                    embed.set_footer(text="Powered by Cataas API")
                    await ctx.send(embeds=[embed], files=[file])
                else:
                    await ctx.send("😿 Couldn't fetch a cat picture. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /cat command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /dog Command
# -------------------------------------------------------------------
@bot.slash_command(name="dog", description="Get a random dog picture!")
async def dog_image(ctx: interactions.ComponentContext):
    try:
        await ctx.defer()
        dog_api_url = "https://dog.ceo/api/breeds/image/random"
        async with aiohttp.ClientSession() as session:
            async with session.get(dog_api_url) as response:
                if response.status == 200:
                    data = await response.json()
                    image_url = data.get("message", None)
                    if image_url:
                        image_url_with_timestamp = f"{image_url}?timestamp={int(time.time())}"
                        async with session.get(image_url_with_timestamp) as image_response:
                            if image_response.status == 200:
                                image_bytes = await image_response.read()
                                file_obj = io.BytesIO(image_bytes)
                                file_obj.seek(0)
                                filename = "dog.jpg"
                                file = File(file_name=filename, file=file_obj)
                                embed = Embed(
                                    title="Random Dog Picture",
                                    description="Here's a doggo for you!",
                                    color=0xD3D3D3,
                                )
                                embed.set_image(url=f"attachment://{filename}")
                                embed.set_footer(text="Powered by Dog CEO API")
                                await ctx.send(embeds=[embed], files=[file])
                            else:
                                await ctx.send("🐶 Couldn't fetch a dog picture. Try again later.")
                    else:
                        await ctx.send("🐶 Couldn't find a dog picture. Try again later.")
                else:
                    await ctx.send("🐕 Couldn't fetch a dog picture. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /dog command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /timezone Command
# -------------------------------------------------------------------
@bot.slash_command(name="timezone", description="Get the current time in a city.")
@interactions.slash_option(
    name="city",
    description="Enter a city name (e.g., New York, London, Tokyo).",
    required=True,
    opt_type=OptionType.STRING,
)
async def timezone_lookup(ctx: interactions.ComponentContext, city: str):
    try:
        await ctx.defer()
        async with aiohttp.ClientSession() as session:
            geocode_url = "https://maps.googleapis.com/maps/api/geocode/json"
            geocode_params = {"address": city, "key": GOOGLE_API_KEY}
            async with session.get(geocode_url, params=geocode_params) as response:
                if response.status == 200:
                    geo_data = await response.json()
                    if geo_data.get("results"):
                        location = geo_data["results"][0]["geometry"]["location"]
                        lat, lng = location["lat"], location["lng"]
                    else:
                        await ctx.send(f"❌ Could not find the city '{city}'. Check spelling.")
                        return
                else:
                    await ctx.send("⚠️ Google Geocoding API error. Try again later.")
                    return
            timestamp = int(datetime.datetime.now().timestamp())
            timezone_url = "https://maps.googleapis.com/maps/api/timezone/json"
            timezone_params = {"location": f"{lat},{lng}", "timestamp": timestamp, "key": GOOGLE_API_KEY}
            async with session.get(timezone_url, params=timezone_params) as response:
                if response.status == 200:
                    tz_data = await response.json()
                    if tz_data.get("status") == "OK":
                        timezone_name = tz_data["timeZoneId"]
                        raw_offset = tz_data["rawOffset"] / 3600
                        dst_offset = tz_data["dstOffset"] / 3600
                        utc_offset = raw_offset + dst_offset
                        is_dst = "Yes" if dst_offset > 0 else "No"
                        current_utc_time = datetime.datetime.now(datetime.timezone.utc)
                        local_time = current_utc_time + datetime.timedelta(hours=utc_offset)
                        formatted_time = local_time.strftime("%Y-%m-%d %H:%M:%S")
                        embed = Embed(
                            title=f"Current Time in {city}",
                            description=f"⏰ {formatted_time} (UTC {utc_offset:+})",
                            color=0x1D4ED8,
                        )
                        embed.add_field(name="Timezone", value=timezone_name, inline=True)
                        embed.add_field(name="UTC Offset", value=f"UTC {utc_offset:+}", inline=True)
                        embed.add_field(name="Daylight Savings", value=is_dst, inline=True)
                        embed.set_footer(text="Powered by Google Maps Time Zone API")
                        await ctx.send(embed=embed)
                    else:
                        await ctx.send(f"❌ Error retrieving timezone info for '{city}'.")
                else:
                    await ctx.send("⚠️ Google Time Zone API error. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /timezone command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /timedifference Command
# -------------------------------------------------------------------
@bot.slash_command(name="timedifference", description="Get the time difference between two places.")
@interactions.slash_option(
    name="place1",
    description="Enter the first city name (e.g., New York).",
    required=True,
    opt_type=OptionType.STRING,
)
@interactions.slash_option(
    name="place2",
    description="Enter the second city name (e.g., London).",
    required=True,
    opt_type=OptionType.STRING,
)
async def time_difference(ctx: interactions.ComponentContext, place1: str, place2: str):
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
            await ctx.send(f"❌ Could not retrieve timezones for '{place1}' or '{place2}'.")
            return
        time_diff = abs(offset1 - offset2)
        await ctx.send(f"⏳ The time difference between {place1.title()} and {place2.title()} is {time_diff} hours.")
    except Exception as e:
        logger.exception(f"Error in /timedifference command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /joke Command
# -------------------------------------------------------------------
@bot.slash_command(name="joke", description="Get a random joke.")
async def random_joke(ctx: interactions.ComponentContext):
    try:
        await ctx.defer()
        joke_url = "https://v2.jokeapi.dev/joke/Dark"
        async with aiohttp.ClientSession() as session:
            async with session.get(joke_url) as response:
                if response.status == 200:
                    data = await response.json()
                    joke = data.get("joke") or f"{data.get('setup')}\n{data.get('delivery')}"
                    category = data.get("category", "Unknown")
                    embed = Embed(
                        title=f"Random Joke ({category})",
                        description=joke,
                        color=0xD3D3D3,
                    )
                    await ctx.send(embed=embed)
                else:
                    await ctx.send("🤷 Couldn't fetch a joke. Try again later.")
    except Exception as e:
        logger.exception(f"Error in /joke command: {e}")
        await ctx.send("⚠️ An unexpected error occurred. Please try again later.", ephemeral=True)


# -------------------------------------------------------------------
# /warp Command
# -------------------------------------------------------------------
@bot.slash_command(name="warp", description="Apply a warp effect to a user's profile picture.")
@interactions.slash_option(
    name="user",
    description="Select a user to warp their profile picture.",
    required=True,
    opt_type=OptionType.USER,
)
@interactions.slash_option(
    name="mode",
    description="Select the warp mode.",
    required=True,
    opt_type=OptionType.STRING,
    choices=[
        {"name": "Swirl", "value": "swirl"},
        {"name": "Bulge", "value": "bulge"},
    ],
)
@interactions.slash_option(
    name="strength",
    description="Warp strength (0 = none, 6 = extreme, default = 6).",
    required=False,
    opt_type=OptionType.INTEGER,
    min_value=0,
    max_value=6,
)
async def warp(ctx: interactions.ComponentContext, user: interactions.User, mode: str, strength: int = 6):
    await ctx.defer()
    try:
        avatar_url = f"{user.avatar_url}"
        if not avatar_url:
            await ctx.send("❌ This user has no profile picture.", ephemeral=True)
            return
        async with aiohttp.ClientSession() as session:
            async with session.get(avatar_url) as resp:
                if resp.status != 200:
                    await ctx.send("❌ Failed to fetch profile picture.", ephemeral=True)
                    return
                image_bytes = await resp.read()
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        width, height = img.size
        img_np = np.array(img)
        if strength == 0:
            output_buffer = io.BytesIO()
            img.save(output_buffer, format="PNG")
            output_buffer.seek(0)
            file = File(file=output_buffer, file_name="original.png")
            await ctx.send(files=[file])
            return
        center_x, center_y = width // 2, height // 2
        strength_map = {0: 0, 1: 0.05, 2: 0.1, 3: 0.2, 4: 0.3, 5: 0.5, 6: 0.7}
        effect_strength = strength_map.get(strength, 0.3)
        effect_radius = min(width, height) // 2
        x_coords, y_coords = np.meshgrid(np.arange(width), np.arange(height))
        dx = x_coords - center_x
        dy = y_coords - center_y
        distance = np.sqrt(dx**2 + dy**2)
        angle = np.arctan2(dy, dx)
        if mode == "swirl":
            warped_angle = angle + (7 * effect_strength * np.exp(-distance / effect_radius))
            new_x_coords = (center_x + distance * np.cos(warped_angle)).astype(int)
            new_y_coords = (center_y + distance * np.sin(warped_angle)).astype(int)
        elif mode == "bulge":
            normalized_distance = distance / effect_radius
            bulge_factor = 1 + effect_strength * (normalized_distance**2 - 1)
            bulge_factor = np.clip(bulge_factor, 0.5, 3.0)
            new_x_coords = (center_x + bulge_factor * dx).astype(int)
            new_y_coords = (center_y + bulge_factor * dy).astype(int)
        else:
            await ctx.send("❌ Invalid warp mode selected.", ephemeral=True)
            return
        new_x_coords = np.clip(new_x_coords, 0, width - 1)
        new_y_coords = np.clip(new_y_coords, 0, height - 1)
        warped_img_np = img_np[new_y_coords, new_x_coords]
        warped_img = Image.fromarray(warped_img_np)
        output_buffer = io.BytesIO()
        warped_img.save(output_buffer, format="PNG")
        output_buffer.seek(0)
        file = File(file=output_buffer, file_name=f"{mode}_warp.png")
        await ctx.send(files=[file])
    except Exception as e:
        logger.exception(f"Error in /warp command: {e}")
        await ctx.send("⚠️ An error occurred while processing the image. Please try again later.", ephemeral=True)
