import interactions
from config import DISCORD_BOT_TOKEN

bot = interactions.Client(
    intents=(interactions.Intents.DEFAULT | interactions.Intents.MESSAGE_CONTENT | interactions.Intents.GUILD_MEMBERS)
)
