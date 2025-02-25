import io
import time
import asyncio
import numpy as np
from PIL import Image
import logging
import aiohttp
from interactions import slash_command, ComponentContext, File, slash_option, OptionType
from logging_setup import logger

@slash_command(name="cat", description="Get a random cat picture!")
async def cat_image(ctx: ComponentContext):
    try:
        await ctx.defer()
        cat_api_url = f"https://cataas.com/cat?timestamp={int(time.time())}"
        async with aiohttp.ClientSession() as session:
            async with session.get(cat_api_url) as response:
                if response.status == 200:
                    image_bytes = await response.read()
                    file_obj = io.BytesIO(image_bytes)
                    file_obj.seek(0)
                    file = File(file_name="cat.jpg", file=file_obj)
                    embed = {
                        "title": "Random Cat Picture",
                        "description": "😺 Here's a cat for you!",
                        "color": 0xD3D3D3,
                        "image": {"url": "attachment://cat.jpg"},
                        "footer": {"text": "Powered by Cataas API"}
                    }
                    await ctx.send(embeds=[embed], files=[file])
                else:
                    await ctx.send("😿 Couldn't fetch a cat picture.")
    except Exception as e:
        logger.exception(f"Error in /cat command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

@slash_command(name="dog", description="Get a random dog picture!")
async def dog_image(ctx: ComponentContext):
    try:
        await ctx.defer()
        dog_api_url = "https://dog.ceo/api/breeds/image/random"
        async with aiohttp.ClientSession() as session:
            async with session.get(dog_api_url) as response:
                if response.status == 200:
                    data = await response.json()
                    image_url = data.get("message")
                    if image_url:
                        image_url_with_timestamp = f"{image_url}?timestamp={int(time.time())}"
                        async with session.get(image_url_with_timestamp) as image_response:
                            if image_response.status == 200:
                                image_bytes = await image_response.read()
                                file_obj = io.BytesIO(image_bytes)
                                file = File(file_name="dog.jpg", file=file_obj)
                                embed = {
                                    "title": "Random Dog Picture",
                                    "description": "🐶 Here's a doggo for you!",
                                    "color": 0xD3D3D3,
                                    "image": {"url": "attachment://dog.jpg"},
                                    "footer": {"text": "Powered by Dog CEO API"}
                                }
                                await ctx.send(embeds=[embed], files=[file])
                            else:
                                await ctx.send("🐶 Couldn't fetch a dog picture.")
                    else:
                        await ctx.send("🐶 Couldn't find a dog picture.")
                else:
                    await ctx.send("🐕 Couldn't fetch a dog picture.")
    except Exception as e:
        logger.exception(f"Error in /dog command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

@slash_command(name="joke", description="Get a random joke.")
async def random_joke(ctx: ComponentContext):
    try:
        await ctx.defer()
        joke_url = "https://v2.jokeapi.dev/joke/Dark"
        async with aiohttp.ClientSession() as session:
            async with session.get(joke_url) as response:
                if response.status == 200:
                    data = await response.json()
                    joke = data.get("joke") or f"**{data.get('setup')}**\n{data.get('delivery')}"
                    category = data.get("category", "Unknown")
                    embed = {
                        "title": f"😂 Random Joke ({category})",
                        "description": joke,
                        "color": 0xD3D3D3
                    }
                    await ctx.send(embed=embed)
                else:
                    await ctx.send("🤷 Couldn't fetch a joke.")
    except Exception as e:
        logger.exception(f"Error in /joke command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

@slash_command(name="warp", description="Apply a warp effect to a user's profile picture.")
@slash_option(name="user", description="Select a user", required=True, opt_type=OptionType.USER)
@slash_option(name="mode", description="Select the warp mode", required=True, opt_type=OptionType.STRING, choices=[
    {"name": "Swirl", "value": "swirl"},
    {"name": "Bulge", "value": "bulge"},
    {"name": "Ripple", "value": "ripple"},
    {"name": "Fisheye", "value": "fisheye"}
])
@slash_option(name="strength", description="Warp strength (0-6, Default: 6)", required=False, opt_type=OptionType.INTEGER, min_value=0, max_value=6)
async def warp(ctx: ComponentContext, user, mode: str, strength: int = 6):
    try:
        await ctx.defer()
        avatar_url = str(user.avatar_url)
        if not avatar_url:
            await ctx.send("❌ User has no profile picture.", ephemeral=True)
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
        elif mode == "ripple":
            wavelength = effect_radius / 5
            amplitude = effect_strength * effect_radius * 0.1
            new_x_coords = (x_coords + amplitude * np.sin(2 * np.pi * y_coords / wavelength)).astype(int)
            new_y_coords = (y_coords + amplitude * np.sin(2 * np.pi * x_coords / wavelength)).astype(int)
        elif mode == "fisheye":
            norm_x = (x_coords - center_x) / effect_radius
            norm_y = (y_coords - center_y) / effect_radius
            r = np.sqrt(norm_x**2 + norm_y**2)
            r_safe = np.where(r == 0, 1e-6, r)
            theta = np.arctan(r * effect_strength * 2)
            factor = np.where(r > 0, theta / r_safe, 1)
            new_x_coords = (center_x + norm_x * factor * effect_radius).astype(int)
            new_y_coords = (center_y + norm_y * factor * effect_radius).astype(int)
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
        await ctx.send("⚠️ An error occurred while processing the image.", ephemeral=True)
