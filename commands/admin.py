import datetime
import uuid
import logging
from interactions import slash_command, slash_option, OptionType, ComponentContext, Permissions
from supabase_helpers import get_value, set_value, get_reminder_data, set_reminder_data, delete_reminder_data
from reminders import handle_reminder
from logging_setup import logger
from bot_instance import bot

@slash_command(name="reminder", description="Setup and check the status of bump and boop reminders.")
@slash_option(name="channel", description="Channel to send reminders in (leave empty to check status)", required=False, opt_type=OptionType.CHANNEL)
@slash_option(name="role", description="Role to ping in reminders (leave empty to check status)", required=False, opt_type=OptionType.ROLE)
async def reminder(ctx: ComponentContext, channel=None, role=None):
    try:
        if channel and role:
            if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
                logger.warning(f"Unauthorized /reminder setup attempt by {ctx.author.username}")
                await ctx.send("❌ You do not have permission.", ephemeral=True)
                return
            logger.debug(f"Reminder setup by {ctx.author.username}: Channel: {channel.name}, Role: {role.id}")
            set_value("reminder_channel", channel.id)
            set_value("role", role.id)
            await ctx.send(f"✅ Reminder setup complete! Reminders will be sent in {channel.name} and ping {role.mention}.")
            return
        channel_id = get_value("reminder_channel")
        role_id = get_value("role")
        channel_str = channel.name if (channel_id and bot.get_channel(channel_id)) else "Not set!"
        role_str = f"<@&{role_id}>" if role_id else "Not set!"
        reminders_info = []
        from reminders import calculate_remaining_time
        for reminder_key in ["disboard", "discadia", "dsme", "unfocused"]:
            data = get_reminder_data(reminder_key)
            time_str = calculate_remaining_time(data.get("scheduled_time")) if data else "Not set!"
            reminders_info.append(f"⏳ **{reminder_key.capitalize()}**: {time_str}")
        summary = f"📌 **Reminder Status:**\n📢 **Channel:** {channel_str}\n🎭 **Role:** {role_str}\n\n" + "\n".join(reminders_info)
        await ctx.send(summary)
    except Exception as e:
        logger.exception(f"Error in /reminder command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

@slash_command(name="fix", description="Runs the fix logic for a service.")
@slash_option(name="service", description="Service to generate fix for", required=True, opt_type=OptionType.STRING)
async def fix_command(ctx: ComponentContext, service: str):
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        await ctx.send("❌ You do not have permission.", ephemeral=True)
        logger.warning(f"Unauthorized /fix attempt by {ctx.author.username}")
        return
    try:
        await ctx.defer()
        logger.debug(f"/fix command from {ctx.author.username} for service: {service}")
        service_delays = {"disboard": 7200, "dsme": 43200, "unfocused": 30600, "discadia": 43200}
        if service not in service_delays:
            logger.warning(f"Invalid service name: {service}")
            await ctx.send("⚠️ Invalid service name.", ephemeral=True)
            return
        seconds = service_delays[service]
        reminder_id = str(uuid.uuid4())
        set_reminder_data(service, True, (datetime.datetime.now(tz=datetime.timezone.utc) + datetime.timedelta(seconds=seconds)).isoformat(), reminder_id)
        logger.debug(f"Fix logic applied for {service}.")
        await ctx.send(f"✅ Fix logic applied for {service}!")
    except Exception as e:
        logger.exception(f"Error in /fix command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

@slash_command(name="resetreminders", description="Reset all reminders to default values.")
async def reset_reminders(ctx: ComponentContext):
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /resetreminders attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission.", ephemeral=True)
        return
    try:
        await ctx.defer()
        for key in ["disboard", "dsme", "unfocused", "discadia"]:
            set_reminder_data(key, False, None, None)
            logger.debug(f"Reset reminder for {key}.")
        await ctx.send("✅ All reminders reset.")
    except Exception as e:
        logger.exception(f"Error in /resetreminders command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

@slash_command(name="mutemode", description="Toggle mute mode (auto-kicking silent users).")
@slash_option(name="enabled", description="Enable or disable mute mode", required=True, opt_type=OptionType.STRING, choices=[{"name": "Enabled", "value": "enabled"}, {"name": "Disabled", "value": "disabled"}])
@slash_option(name="time", description="Time limit in hours before kick", required=False, opt_type=OptionType.INTEGER)
async def toggle_mute_mode(ctx: ComponentContext, enabled: str, time: int = 2):
    is_enabled = True if enabled.lower() == "enabled" else False
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /mutemode attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission.", ephemeral=True)
        return
    try:
        set_value("mute_mode", is_enabled)
        set_value("mute_mode_kick_time_hours", time)
        response = (f"🔇 Mute mode enabled. Users must send a message within {time} hours." if is_enabled else "🔇 Mute mode disabled.")
        await ctx.send(response)
    except Exception as e:
        logger.exception(f"Error in /mutemode command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

@slash_command(name="backupmode", description="Configure and toggle backup mode for new members.")
@slash_option(name="channel", description="Channel for welcome messages", required=False, opt_type=OptionType.CHANNEL)
@slash_option(name="role", description="Role to assign to new members", required=False, opt_type=OptionType.ROLE)
@slash_option(name="enabled", description="Enable or disable auto-role assignment", required=False, opt_type=OptionType.BOOLEAN)
async def backup_mode(ctx: ComponentContext, channel=None, role=None, enabled: bool = None):
    try:
        if channel or role or enabled is not None:
            if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
                logger.warning(f"Unauthorized /backupmode attempt by {ctx.author.username}")
                await ctx.send("❌ You do not have permission.", ephemeral=True)
                return
            if channel:
                set_value("backup_mode_channel", channel.id)
            if role:
                set_value("backup_mode_id", role.id)
            if enabled is not None:
                set_value("backup_mode_enabled", enabled)
            await ctx.send("🔄 Backup Mode Configured!")
            return
        channel_id = get_value("backup_mode_channel")
        role_id = get_value("backup_mode_id")
        enabled_status = get_value("backup_mode_enabled")
        channel_str = channel.name if (channel_id and bot.get_channel(channel_id)) else "Not set!"
        role_str = f"<@&{role_id}>" if role_id else "Not set!"
        enabled_str = "✅ Enabled" if enabled_status else "❌ Disabled"
        summary = f"📌 Backup Mode Status:\nChannel: {channel_str}\nRole: {role_str}\nAuto-role: {enabled_str}"
        await ctx.send(summary)
    except Exception as e:
        logger.exception(f"Error in /backupmode command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

@slash_command(name="trollmode", description="Toggle kicking of accounts younger than a specified age.")
@slash_option(name="enabled", description="Enable or disable troll mode", required=True, opt_type=OptionType.STRING, choices=[{"name": "Enabled", "value": "enabled"}, {"name": "Disabled", "value": "disabled"}])
@slash_option(name="age", description="Minimum account age in days", required=False, opt_type=OptionType.INTEGER)
async def toggle_troll_mode(ctx: ComponentContext, enabled: str, age: int = 30):
    is_enabled = True if enabled.lower() == "enabled" else False
    if not ctx.author.has_permission(Permissions.ADMINISTRATOR):
        logger.warning(f"Unauthorized /trollmode attempt by {ctx.author.username}")
        await ctx.send("❌ You do not have permission.", ephemeral=True)
        return
    try:
        set_value("troll_mode", is_enabled)
        set_value("troll_mode_account_age", age)
        response = (f"👹 Troll mode enabled. Minimum account age: {age} days." if is_enabled else "👹 Troll mode disabled.")
        await ctx.send(response)
    except Exception as e:
        logger.exception(f"Error in /trollmode command: {e}")
        await ctx.send("⚠️ An error occurred.", ephemeral=True)

# Commands for bump/boop reminders
async def disboard():
    await handle_reminder(
        key="disboard",
        initial_message="Thanks for bumping on Disboard! I'll remind you later.",
        reminder_message="It's time to bump on Disboard again!",
        interval=7200
    )

async def dsme():
    await handle_reminder(
        key="dsme",
        initial_message="Thanks for voting on DS.me! I'll remind you later.",
        reminder_message="It's time to vote on DS.me again!",
        interval=43200
    )

async def unfocused():
    await handle_reminder(
        key="unfocused",
        initial_message="Thanks for booping on Unfocused! I'll remind you later.",
        reminder_message="It's time to boop on Unfocused again!",
        interval=30600
    )

async def discadia():
    await handle_reminder(
        key="discadia",
        initial_message="Thanks for bumping on Discadia! I'll remind you later.",
        reminder_message="It's time to bump on Discadia again!",
        interval=43200
    )

# Export these functions so other modules (like events.py) can call them.
__all__ = ["disboard", "dsme", "unfocused", "discadia"]
