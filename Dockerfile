FROM python:3.13-bookworm

# Set the working directory
WORKDIR /app
FROM python:alpine

# Upgrade pip and install dependencies without cache
RUN pip install --upgrade pip && \
    pip install --no-cache-dir discord-py-interactions pytz aiohttp sentry-sdk supabase numpy opencv-python-headless pillow

# Copy the application code into the container
COPY main.py .

# Define the default command
CMD ["python", "-u", "main.py"]