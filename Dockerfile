FROM python:3.13-slim

# Set the working directory
WORKDIR /app
FROM python:alpine

# Upgrade pip and install dependencies without cache
RUN pip install --upgrade pip && \
    pip install --no-cache-dir aiohttp discord-py-interactions numpy pytz sentry-sdk pillow supabase

# Copy the application code into the container
COPY main.py .
COPY nova/ nova/

# Define the default command
CMD ["python", "-u", "main.py"]