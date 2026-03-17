# LiveKit Agent Worker for Anam Avatar
# Runs the ai-avatar-workshop agent as a Docker service

FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir \
    livekit-agents>=1.0.0 \
    livekit-plugins-anam \
    livekit-plugins-deepgram \
    livekit-plugins-noise-cancellation \
    livekit-plugins-openai \
    livekit-plugins-silero \
    livekit-plugins-turn-detector \
    python-dotenv \
    pydantic \
    huggingface_hub \
    httpx

# Copy agent source code first (needed for download-files command)
COPY src/agent.py /app/agent.py

# Copy form schemas — agent.py resolves path as: dirname(/app/agent.py)/../frontend/public/forms = /frontend/public/forms
COPY frontend/public/forms /frontend/public/forms

# Download all model files (turn-detector ONNX, silero VAD, etc.) using the agent's built-in command
RUN python agent.py download-files

# The agent uses `cli.run_app(server)` which accepts CLI args
# "start" = production mode (connects to LiveKit Cloud and waits for dispatch)
CMD ["python", "agent.py", "start"]
