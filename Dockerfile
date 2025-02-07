FROM python:3.13-bookworm

# Set the working directory
WORKDIR /app
FROM python:alpine

# Install linux dependencies
RUN apt-get update && apt-get install -y \
    python3-opencv \
    cmake \
    build-essential \
    libglib2.0-0 \
    libsm6 \
    libxrender-dev \
    libxext6 \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip and install dependencies without cache
RUN pip install --upgrade pip && \
    pip install --no-cache-dir discord-py-interactions pytz aiohttp sentry-sdk supabase numpy opencv-python-headless pillow

# Copy the application code into the container
COPY main.py .

# Define the default command
CMD ["python", "-u", "main.py"]