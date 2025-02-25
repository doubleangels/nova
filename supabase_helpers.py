import json
import logging
from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_KEY

logger = logging.getLogger("Nova")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_value(key: str):
    try:
        response = supabase.table("config").select("value").eq("id", key).maybe_single().execute()
        if response is None:
            logger.warning(f"Supabase query for key '{key}' returned None.")
            return None
        if response.data and isinstance(response.data, dict) and "value" in response.data:
            return json.loads(response.data["value"])
        logger.warning(f"Key '{key}' not found in Supabase or data missing.")
        return None
    except Exception:
        logger.exception(f"Error getting key '{key}' in Supabase.")
        return None

def set_value(key: str, value):
    try:
        serialized = json.dumps(value)
        existing = get_value(key)
        if existing is None:
            supabase.table("config").insert({"id": key, "value": serialized}).execute()
            logger.debug(f"Inserted new config entry for key '{key}'.")
        else:
            supabase.table("config").update({"value": serialized}).eq("id", key).execute()
            logger.debug(f"Updated config entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error setting key '{key}' in Supabase.")

def delete_value(key: str):
    try:
        supabase.table("config").delete().eq("id", key).execute()
        logger.debug(f"Deleted config entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error deleting key '{key}' in Supabase.")

def get_reminder_data(key: str):
    try:
        response = supabase.table("reminders").select("state", "scheduled_time", "reminder_id").eq("key", key).maybe_single().execute()
        if response and response.data:
            return {
                "state": response.data.get("state", False),
                "scheduled_time": response.data.get("scheduled_time"),
                "reminder_id": response.data.get("reminder_id")
            }
        return None
    except Exception:
        logger.exception(f"Error getting reminder data for key '{key}'.")
        return None

def set_reminder_data(key: str, state: bool, scheduled_time, reminder_id: str):
    try:
        data = {
            "key": key,
            "state": state,
            "scheduled_time": scheduled_time,
            "reminder_id": reminder_id
        }
        existing = get_reminder_data(key)
        if existing is None:
            supabase.table("reminders").insert(data).execute()
            logger.debug(f"Inserted new reminder entry for key '{key}'.")
        else:
            supabase.table("reminders").update(data).eq("key", key).execute()
            logger.debug(f"Updated reminder entry for key '{key}'.")
    except Exception:
        logger.exception(f"Error setting reminder data for key '{key}'.")

def delete_reminder_data(key: str):
    try:
        supabase.table("reminders").delete().eq("key", key).execute()
        logger.debug(f"Deleted reminder data for key '{key}'.")
    except Exception:
        logger.exception(f"Error deleting reminder data for key '{key}'.")

def track_new_member(member_id: int, username: str, join_time: str):
    try:
        response = supabase.table("tracked_members").upsert({
            "member_id": member_id,
            "join_time": join_time,
            "username": username
        }).execute()
        if response:
            logger.debug(f"Tracked new member: {username} at {join_time}.")
        else:
            logger.warning(f"Failed to track {username} - No response from Supabase.")
    except Exception as e:
        logger.exception(f"Error tracking new member {username}: {e}")

def get_tracked_member(member_id: int):
    try:
        response = supabase.table("tracked_members").select("*").eq("member_id", member_id).maybe_single().execute()
        if response and response.data:
            return response.data
        return None
    except Exception:
        logger.exception(f"Error retrieving tracked data for member {member_id}.")
        return None

def remove_tracked_member(member_id: int):
    try:
        response = supabase.table("tracked_members").delete().eq("member_id", member_id).execute()
        resp_dict = response.dict()
        if resp_dict.get("error"):
            logger.error("Failed to remove tracked member.")
        elif not resp_dict.get("data"):
            logger.debug("No tracked member found. Nothing to remove.")
        else:
            logger.debug("Removed tracked member.")
    except Exception as e:
        logger.exception(f"Error removing tracked member {member_id}: {e}")

def get_all_tracked_members():
    try:
        response = supabase.table("tracked_members").select("member_id", "username", "join_time").execute()
        if response and response.data:
            return response.data
        return []
    except Exception:
        logger.exception("Error retrieving all tracked members from Supabase.")
        return []
