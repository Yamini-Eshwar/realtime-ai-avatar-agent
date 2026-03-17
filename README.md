# Real-Time AI Avatar Agent

> A real-time, lip-synced AI avatar that conducts voice conversations to fill out intake forms — no typing, no waiting, just talk.

https://github.com/user-attachments/assets/YOUR_VIDEO_ID_HERE

## The Problem

Every day, millions of people sit in waiting rooms filling out paper forms or clicking through clunky web forms. Healthcare clinics, government offices, hotels, gyms — they all force users through the same friction: read a field, type an answer, repeat. It's slow, inaccessible for many, and a terrible first impression.

**What if a human-like AI avatar could just _ask_ you the questions instead?**

## What This Does

This project is a **production-grade voice AI agent** with a photo-realistic avatar that:

1. **Greets the user** with a natural opening and explains what information is needed
2. **Asks questions conversationally** — one field at a time, in spoken English
3. **Listens to spoken answers**, transcribes them, and fills in the form in real-time
4. **Shows lip-synced video** — the avatar's mouth moves naturally with the speech
5. **Validates and confirms** — spells back names, asks for corrections, handles "go back"
6. **Submits the completed form** once all fields are collected

The user sees a split-screen: the avatar on the left talking to them, and the form on the right filling itself in as they speak.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Next.js)                        │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
│  │ Avatar Panel  │  │  Dynamic Form    │  │  Chat Transcript │  │
│  │ (video track) │  │  (auto-fills)    │  │  (live captions) │  │
│  └──────┬───────┘  └────────┬─────────┘  └──────────────────┘  │
│         │ WebRTC            │ RPC                               │
└─────────┼───────────────────┼───────────────────────────────────┘
          │                   │
          ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LiveKit Cloud (WebRTC SFU)                   │
│                                                                 │
│   Participants:                                                 │
│   ├── User (browser) ── publishes mic audio                     │
│   ├── Agent (Python) ── subscribes to audio, publishes TTS      │
│   └── Anam Worker ──── receives TTS, publishes lip-synced video │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Deepgram │ │  OpenAI  │ │   Anam   │
        │ STT: Nova│ │ GPT-4o   │ │ Avatar   │
        │ TTS: Aura│ │ -mini    │ │ Lip-Sync │
        └──────────┘ └──────────┘ └──────────┘
```

**How the pipeline works, end to end:**

| Step | What happens | Latency |
|------|-------------|---------|
| 1 | User speaks into mic | — |
| 2 | Audio streams to LiveKit Cloud via WebRTC | ~50ms |
| 3 | Deepgram Nova-3 transcribes speech to text | ~300ms |
| 4 | GPT-4o-mini generates a response + calls `update_field()` tool | ~400ms |
| 5 | Deepgram Aura-2 converts response text to speech audio | ~200ms |
| 6 | Anam receives audio and generates lip-synced avatar video | ~150ms |
| 7 | Video streams back to browser via LiveKit | ~50ms |
| **Total** | **User speaks → avatar responds with synced lips** | **~1.2s** |

## Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| **Frontend** | Next.js 15, React 19, TypeScript | UI, form rendering, avatar display |
| **UI Components** | shadcn/ui, Radix, Tailwind CSS 4 | Accessible component library |
| **WebRTC** | LiveKit Client SDK | Real-time audio/video transport |
| **Agent Framework** | LiveKit Agents SDK (Python) | Orchestrates the AI pipeline |
| **Speech-to-Text** | Deepgram Nova-3 | Real-time transcription (45+ languages) |
| **LLM** | OpenAI GPT-4o-mini | Conversational logic + tool calling |
| **Text-to-Speech** | Deepgram Aura-2 | Natural voice synthesis (16kHz) |
| **Avatar** | Anam AI | Photo-realistic lip-synced video |
| **VAD** | Silero | Voice activity detection |
| **Turn Detection** | LiveKit Multilingual Model | Knows when user finished speaking |
| **Deployment** | Docker | Containerized agent worker |

## Key Design Decisions

### Why LiveKit instead of raw WebSockets?

WebSockets send audio as binary blobs over TCP. That means buffering, head-of-line blocking, and no adaptive bitrate. LiveKit uses WebRTC — UDP-based, adaptive, and handles opacket loss gracefully. For a real-time voice conversation where 50ms matters, WebRTC is non-negotiable.

### Why Anam for the avatar?

Compared to alternatives like HeyGen or D-ID:
- **Anam runs through LiveKit** — the avatar is just another participant in the room publishing a video track. No separate video stream to manage.
- **Sub-200ms lip-sync** — Anam processes TTS audio chunks and returns video in near real-time
- **No iframe embedding** — it's a native WebRTC video track, so it composites cleanly with the rest of the UI

### Why GPT-4o-mini and not GPT-4o?

The agent's job is structured: ask a question, extract the answer, call a tool. It doesn't need deep reasoning. GPT-4o-mini is 15x cheaper with comparable function-calling accuracy for this use case.

### Why Deepgram for both STT and TTS?

Using the same provider for both reduces integration surface. Deepgram's Nova-3 is the fastest production STT available (~300ms), and Aura-2 at 16kHz is specifically compatible with Anam's lip-sync pipeline (which requires 16kHz input).

## Supported Form Types

The agent dynamically adapts its conversation based on the form schema. Ship a new JSON file, and the agent learns to ask those questions:

| Form | Fields | Use Case |
|------|--------|----------|
| Visitor Intake | Name, DOB, address, emergency contact, medical history | Healthcare clinics |
| Dental Reception | Patient info, insurance, dental history | Dental offices |
| Hotel Check-in | Guest details, room preferences, ID verification | Hospitality |
| Gym Check-in | Member info, health declaration, goals | Fitness centers |
| Employee Check-in | Employee ID, department, equipment checklist | Corporate offices |
| Library Visitor | Card number, purpose, contact info | Public libraries |
| Feedback Survey | Rating, experience, suggestions | Any service |

### Form Schema Format

```json
{
  "id": "visitor-intake",
  "title": "Visitor Intake Form",
  "sections": [
    {
      "title": "Personal Info",
      "fields": [
        {
          "id": "fullName",
          "label": "Full Name",
          "type": "text",
          "placeholder": "Legal name",
          "required": true
        }
      ]
    }
  ]
}
```

Drop a new JSON file in `frontend/public/forms/` → the agent automatically generates conversational instructions from the schema at runtime.

## Project Structure

```
.
├── src/
│   └── agent.py                  # LiveKit agent — orchestrates STT → LLM → TTS → Avatar
├── frontend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── connection-details/   # Generates LiveKit room tokens
│   │   │   └── forms/                # Form schema CRUD API
│   │   ├── page.tsx                  # Entry point
│   │   └── layout.tsx
│   ├── components/
│   │   └── app/
│   │       ├── app.tsx               # LiveKit session initialization
│   │       ├── session-view.tsx      # Split-screen: avatar + form
│   │       ├── welcome-view.tsx      # Pre-call form selector
│   │       ├── avatar-panel.tsx      # Anam video display + controls
│   │       ├── dynamic-form.tsx      # Schema-driven form renderer
│   │       └── chat-transcript.tsx   # Live conversation transcript
│   ├── hooks/
│   │   └── useRpcHandlers.ts         # Agent ↔ frontend RPC bridge
│   └── public/
│       └── forms/                    # JSON form schemas (7 included)
├── Dockerfile                        # Agent container image
└── .env.example                      # Required API keys
```

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Python 3.12+
- API keys for: [LiveKit Cloud](https://cloud.livekit.io), [Deepgram](https://deepgram.com), [OpenAI](https://platform.openai.com), [Anam AI](https://www.anam.ai)

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_USERNAME/realtime-ai-avatar-agent.git
cd realtime-ai-avatar-agent
cp .env.example .env
# Fill in your API keys in .env
```

### 2. Start the frontend

```bash
cd frontend
pnpm install
pnpm dev
# → http://localhost:3000
```

### 3. Start the agent

```bash
# Install dependencies
pip install livekit-agents livekit-plugins-anam livekit-plugins-deepgram \
  livekit-plugins-openai livekit-plugins-silero livekit-plugins-turn-detector \
  python-dotenv pydantic httpx

# Download model files (VAD, turn detector)
python src/agent.py download-files

# Run in development mode
python src/agent.py dev
```

### 4. Or run with Docker

```bash
docker build -t avatar-agent .
docker run --env-file .env avatar-agent
```

## How the Agent Works (Simplified)

```python
# 1. Load form schema dynamically
schema = await load_form_schema("visitor-intake")

# 2. Auto-generate conversation instructions from schema
instructions = f"""
You are Liv, an intake assistant.
Ask these fields one at a time: {schema.fields}
After each answer, call update_field(field_name, value).
When all fields are collected, call submit_form().
"""

# 3. Wire up the AI pipeline
session = AgentSession(
    stt=deepgram.STT(model="nova-3"),           # Listen
    llm=openai.LLM(model="gpt-4o-mini"),        # Think
    tts=deepgram.TTS(model="aura-2-thalia-en"),  # Speak
    vad=silero.VAD.load(),                        # Detect voice
)

# 4. Start Anam avatar (lip-syncs to TTS audio automatically)
avatar = anam.AvatarSession(persona=PersonaConfig(avatarId="..."))
avatar.start(agent_session=session, room=room)

# 5. Agent starts the conversation
session.generate_reply(instructions="Greet the user and ask the first field.")
```

## Real-World Impact

This isn't a toy demo. Here's why this matters:

- **Accessibility** — People who can't type (elderly, disabled, low-literacy) can now complete forms by just talking
- **Speed** — A 5-minute paper form becomes a 2-minute conversation
- **Multilingual** — Deepgram Nova-3 supports 45+ languages out of the box; the same avatar speaks to anyone
- **Cost** — One AI agent replaces a human receptionist for routine intake, running 24/7 at ~$0.03/conversation
- **Scalability** — Spin up 100 agents for 100 simultaneous users. No hiring, no training, no sick days
- **Drop-in forms** — Add a new JSON schema file and the agent learns new questions instantly — zero code changes

## Environment Variables

```bash
# LiveKit Cloud
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Deepgram (STT + TTS)
DEEPGRAM_API_KEY=your_deepgram_key

# OpenAI (LLM)
OPENAI_API_KEY=your_openai_key

# Anam AI (Avatar)
ANAM_API_KEY=your_anam_key
```

## Demo

> **Video demo of the AI avatar conducting a live visitor intake conversation:**

https://github.com/user-attachments/assets/YOUR_VIDEO_ID_HERE

*Replace this link with your uploaded demo video. GitHub supports video files up to 25MB — drag and drop an MP4 into the README editor.*

## License

MIT
