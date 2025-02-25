import os
import logging
import sys
import sentry_sdk
from sentry_sdk.integrations.logging import LoggingIntegration

sentry_logging = LoggingIntegration(
    level=logging.DEBUG,        # Capture debug and above as breadcrumbs
    event_level=logging.ERROR   # Send errors as events
)

sentry_sdk.init(
    dsn="https://11b0fbce04a61c3cf602b4c2ab444c83@o244019.ingest.us.sentry.io/4508695162060800",
    integrations=[sentry_logging],
    traces_sample_rate=1.0,
    profiles_sample_rate=1.0,
)

LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG").upper()

logger = logging.getLogger("Nova")
logger.setLevel(LOG_LEVEL)
log_format = "%(asctime)s - %(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s"
formatter = logging.Formatter(log_format)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(LOG_LEVEL)
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)
