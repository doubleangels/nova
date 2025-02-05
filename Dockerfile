FROM python:3.11-slim

# Set the working directory
WORKDIR /app
FROM python:alpine

# Upgrade pip and install dependencies without cache
RUN pip install --upgrade pip && \
    pip install --no-cache-dir discord-py-interactions pytz aiohttp sentry-sdk supabase

# Copy the application code into the container
COPY main.py .

# Don't run as root for security reasons
RUN useradd -m nova
USER nova

# Define the default command
CMD ["python", "-u", "main.py"]