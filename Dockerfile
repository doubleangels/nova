FROM python:3.11-slim

# Set the working directory
WORKDIR /app
FROM python:alpine

# Upgrade pip and install dependencies without cache
RUN pip install --upgrade pip && \
    pip install --no-cache-dir discord-py-interactions pytz aiohttp sentry-sdk supabase

# Copy the application code into the container
COPY main.py .

# Define the default command
CMD ["python", "-u", "main.py"]

# Check to make sure the container is healthy
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:8080/health || exit 1