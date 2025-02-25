import logging
from interactions import slash_command, ComponentContext
from logging_setup import logger

@slash_command(name="source", description="Get links for the bot's resources.")
async def source(ctx: ComponentContext):
    try:
        embed = {
            "title": "📜 Bot Resources",
            "description": "Links for the bot's resources:",
            "color": 0x00ff00,
            "fields": [
                {"name": "🖥️ GitHub Repository", "value": "[🔗 Click Here](https://github.com/doubleangels/Nova)", "inline": False},
                {"name": "🗄️ Supabase Database", "value": "[🔗 Click Here](https://supabase.com/dashboard/project/amietgblnpazkunprnxo/editor/29246?schema=public)", "inline": False}
            ]
        }
        await ctx.send(embeds=[embed])
    except Exception as e:
        logger.exception(f"Error in /source command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

@slash_command(name="dev", description="Maintain developer tag.")
async def dev(ctx: ComponentContext):
    try:
        await ctx.send("🛠️ Developer tag maintained!")
    except Exception as e:
        await ctx.send("⚠️ An error occurred.", ephemeral=True)
