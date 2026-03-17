import json
import logging
import os
from typing import Annotated

import httpx
from dotenv import load_dotenv
from pydantic import Field

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    MetricsCollectedEvent,
    RunContext,
    cli,
    function_tool,
    inference,
    llm,
    metrics,
    room_io,
)
from livekit.plugins import anam, deepgram, noise_cancellation, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

logger = logging.getLogger("agent")

load_dotenv()

# ── Cap60 backend base URL (Docker network: backend service on port 8000) ──
CAP60_BACKEND_URL = os.environ.get(
    "CAP60_BACKEND_URL", "http://backend:8000"
)


# ── Form schema helpers ───────────────────────────────────────────────

# Fallback: local forms directory (used only if backend API is unreachable)
FORMS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "forms")
)


async def load_form_schema_from_api(form_id: str) -> dict:
    """Fetch intake schema from cap60 backend API.

    The backend converts its JSON Schema Draft-7 format to the flat
    sections/fields format that build_instructions_from_schema() expects.
    """
    url = f"{CAP60_BACKEND_URL}/api/v1/agent-console/livekit/intake-schema/{form_id}"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.json()


def load_form_schema_local(form_id: str) -> dict:
    """Load a form schema JSON by ID from the local forms directory (fallback)."""
    if not all(c.isalnum() or c in "-_" for c in form_id):
        raise ValueError(f"Invalid form ID: {form_id}")
    path = os.path.join(FORMS_DIR, f"{form_id}.json")
    with open(path, "r") as f:
        return json.load(f)


def get_valid_field_names(schema: dict) -> list[str]:
    """Extract all field IDs from a schema."""
    return [
        field["id"]
        for section in schema["sections"]
        for field in section["fields"]
    ]


def build_instructions_from_schema(schema: dict) -> str:
    """Auto-generate agent instructions from a form schema JSON."""
    title = schema.get("title", "Form")

    # Build section-aware field flow with explicit label→ID mapping
    flow_lines = []
    field_id_list = []
    for section in schema["sections"]:
        flow_lines.append(f"            Section: {section['title']}")
        flow_lines.append(
            f'            (When starting this section, say: "Now let\'s move on to {section["title"].lower()}.")'
        )
        for field in section["fields"]:
            label = field["label"]
            field_id = field["id"]
            field_id_list.append(field_id)
            required_tag = " [REQUIRED]" if field.get("required") else ""
            options_hint = ""
            if field.get("type") == "select" and field.get("options"):
                opts = ", ".join(f'"{o}"' for o in field["options"])
                options_hint = f"  [DROPDOWN — valid values: {opts}] — you MUST use one of these exact values"
            flow_lines.append(
                f"            - Ask: \"{label}\"{required_tag}{options_hint}  →  use field_name=\"{field_id}\""
            )

    field_flow = "\n".join(flow_lines)
    field_ids = ", ".join(field_id_list)
    first_field_label = schema["sections"][0]["fields"][0]["label"].lower()

    return f"""You are Liv, a voice AI avatar powered by LiveKit and Anam. You help visitors complete a {title} one section at a time in a calm, clear, supportive tone.

            Conversation style:
            - Speak in short, natural sentences.
            - Be warm and professional.
            - Keep the user moving forward without rushing them.
            - Do not use markdown, emojis, asterisks, or stage directions.

            One question at a time:
            - Ask for exactly one field per turn. Never ask for two or more fields in the same question.
            - Wait for the answer, confirm it, then move to the next field.

            Form flow (in order, one field per question):
{field_flow}
            - final confirmation loop and submission

            Confirmation rules:
            - Confirm each answer before moving to the next field.
            - For names, read back with spelling when helpful (for example: "Is that J-E-S-S-E H-A-L-L?").
            - If user says "yes," proceed. If user corrects, update and confirm once more.
            - If user is unsure, offer to mark unknown or come back later.

            Tool usage:
            - Use update_field whenever the user provides a value for a form field.
            - IMPORTANT: Always use the exact field_name shown in the flow above (e.g. "{field_id_list[0]}", not "{first_field_label}"). Valid field names: {field_ids}.
            - For list-style fields (e.g. textarea fields where multiple items are expected): when the user names multiple items in one turn, pass every item in a single update_field call as a comma-separated list.
            - If the user adds more items after you have already saved some, use get_form_state to read the current value, then pass the combined list in one update_field call.
            - Use get_form_state before the final confirmation if needed to verify current values.
            - At the end, ask the visitor to confirm whether all entries are accurate.
            - If the visitor says yes, submit the form.
            - If the visitor says no and asks to change something, update the requested field(s), then ask for confirmation again.
            - Repeat this confirmation loop until the visitor explicitly confirms all entries are accurate, then submit.
            - The submit_form tool speaks the final confirmation; do not add your own.

            Opening:
            Start with: "Hi, I'm Liv, here to help you fill out your {title} today. We'll go through it together, one section at a time. Let's start with some basic information."
            Then ask for the visitor's {first_field_label}."""


# ── Agent ─────────────────────────────────────────────────────────────

class IntakeAssistant(Agent):
    def __init__(self, ctx: JobContext, schema: dict, session_id: str | None = None) -> None:
        self._ctx = ctx
        self._schema = schema
        self._valid_fields = get_valid_field_names(schema)
        self._session_id = session_id  # cap60 call_session ID for saving answers
        self._form_state: dict[str, str] = {}  # local cache of answers
        super().__init__(
            instructions=build_instructions_from_schema(schema),
        )

    @function_tool
    async def update_field(
        self,
        context: RunContext,
        field_name: Annotated[
            str,
            Field(description="The field ID to update (use the exact ID from the form flow)"),
        ],
        value: Annotated[
            str,
            Field(
                description="The value to set for the field. For list-style fields, use a single comma-separated string with every item the user mentioned."
            ),
        ],
    ):
        """Update a form field. Use this when the visitor provides information for a specific field. For list-style fields, pass all items in one value as a comma-separated list."""
        if field_name not in self._valid_fields:
            raise llm.LLMToolException(
                f"Invalid field name: {field_name}. Valid names: {', '.join(self._valid_fields)}"
            )

        # Update local cache
        self._form_state[field_name] = value

        # Save to cap60 backend if we have a session ID
        if self._session_id:
            try:
                url = f"{CAP60_BACKEND_URL}/api/v1/agent-console/livekit/save-answer"
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.post(url, json={
                        "session_id": self._session_id,
                        "field_name": field_name,
                        "value": value,
                    })
                    resp.raise_for_status()
                    result = resp.json()
                    logger.info(
                        f"Saved answer to cap60: {field_name}={value}, "
                        f"progress={result.get('current_index')}/{result.get('total_fields')}"
                    )
                    return f"Field '{field_name}' updated to '{value}'. Progress: {result.get('percent', 0)}%"
            except Exception as e:
                logger.warning(f"Failed to save to cap60 backend (keeping local): {e}")

        # Fallback: try RPC to workshop frontend
        try:
            payload = json.dumps({"fieldName": field_name, "value": value})
            response = await perform_rpc_to_frontend(self._ctx, "updateField", payload)
            return response
        except Exception as e:
            # Even if RPC fails, the answer is in local cache
            logger.warning(f"RPC to frontend failed (answer cached locally): {e}")
            return f"Field '{field_name}' updated to '{value}'."

    @function_tool
    async def get_form_state(self, context: RunContext):
        """Get the current state of all form fields. Use this to see what has already been filled in or to verify data before submitting."""
        if self._form_state:
            return json.dumps(self._form_state)

        # Fallback: try RPC to workshop frontend
        try:
            response = await perform_rpc_to_frontend(self._ctx, "getFormState", "{}")
            return response
        except Exception as e:
            raise llm.LLMToolException(f"Failed to get form state: {str(e)}")

    @function_tool
    async def submit_form(self, context: RunContext):
        """Submit the completed form. Use this only when all required fields have been filled and the visitor has confirmed they are ready to submit."""
        # For cap60 integration, the form data is already saved field-by-field
        # Just mark completion
        if self._session_id:
            logger.info(f"Form submitted for session {self._session_id}")
            context.session.say(
                "Your form has been submitted successfully. You will be contacted soon. Thank you."
            )
            return "Form submitted successfully."

        # Fallback: RPC to workshop frontend
        try:
            response = await perform_rpc_to_frontend(self._ctx, "submitForm", "{}")
            context.session.say(
                "Your form has been submitted. You will be contacted soon. Thank you."
            )
            return response
        except Exception as e:
            raise llm.LLMToolException(f"Failed to submit form: {str(e)}")


# ── Helpers ───────────────────────────────────────────────────────────

def get_remote_participant_identity(ctx: JobContext) -> str:
    """Get the identity of the remote participant (user), excluding Anam avatars."""
    for participant in ctx.room.remote_participants.values():
        if not participant.identity.startswith("anam-"):
            return participant.identity
    raise llm.LLMToolException("No remote participant found")


def get_metadata_from_participant(ctx: JobContext) -> dict:
    """Read metadata from the user participant."""
    for participant in ctx.room.remote_participants.values():
        if not participant.identity.startswith("anam-"):
            if participant.metadata:
                try:
                    return json.loads(participant.metadata)
                except (json.JSONDecodeError, TypeError):
                    pass
    return {}


def get_form_id_from_participant(ctx: JobContext) -> str:
    """Read the form ID from the user participant's metadata."""
    meta = get_metadata_from_participant(ctx)
    return meta.get("formId", "visitor-intake")


def get_session_id_from_participant(ctx: JobContext) -> str | None:
    """Read the cap60 session ID from the user participant's metadata."""
    meta = get_metadata_from_participant(ctx)
    return meta.get("sessionId")


def get_anam_avatar_id_from_participant(ctx: JobContext) -> str | None:
    """Read the Anam avatar ID from the user participant's metadata."""
    meta = get_metadata_from_participant(ctx)
    return meta.get("anamAvatarId")


async def perform_rpc_to_frontend(
    ctx: JobContext, method: str, payload: str
) -> str:
    """Perform an RPC call to the frontend participant."""
    local_participant = ctx.room.local_participant
    if not local_participant:
        raise llm.LLMToolException("Agent not connected to room")

    destination_identity = get_remote_participant_identity(ctx)

    response = await local_participant.perform_rpc(
        destination_identity=destination_identity,
        method=method,
        payload=payload,
        response_timeout=5.0,
    )
    return response


async def init_schema_on_backend(session_id: str, intake_type: str, total_fields: int):
    """Tell cap60 backend how many fields this schema has, for progress tracking."""
    url = f"{CAP60_BACKEND_URL}/api/v1/agent-console/livekit/init-schema"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(url, json={
                "session_id": session_id,
                "total_fields": total_fields,
                "intake_type": intake_type,
            })
            resp.raise_for_status()
            logger.info(f"Initialized schema on cap60: {intake_type}, {total_fields} fields")
    except Exception as e:
        logger.warning(f"Failed to init schema on cap60 backend: {e}")


# ── Server ────────────────────────────────────────────────────────────

server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="Anam-Demo")
async def intake_agent(ctx: JobContext):
    ctx.log_context_fields = {
        "room": ctx.room.name,
    }

    await ctx.connect()

    # Read form ID and session ID from participant metadata (set by cap60 frontend)
    form_id = get_form_id_from_participant(ctx)
    session_id = get_session_id_from_participant(ctx)
    logger.info(f"Loading form schema: {form_id}, session_id: {session_id}")

    # Try to load schema from cap60 backend API first, fall back to local files
    schema = None
    try:
        schema = await load_form_schema_from_api(form_id)
        logger.info(f"Loaded schema from cap60 backend API: {form_id}")
    except Exception as e:
        logger.warning(f"Cap60 backend API unavailable ({e}), trying local files")

    if not schema:
        try:
            schema = load_form_schema_local(form_id)
            logger.info(f"Loaded schema from local file: {form_id}")
        except (FileNotFoundError, ValueError) as e:
            logger.warning(f"Failed to load form '{form_id}', falling back to visitor-intake: {e}")
            try:
                schema = load_form_schema_local("visitor-intake")
            except FileNotFoundError:
                logger.error("No form schema available at all!")
                return

    # Count total fields for progress tracking
    total_fields = sum(len(s["fields"]) for s in schema.get("sections", []))

    # Initialize schema metadata on cap60 backend (sets total_fields for progress bar)
    if session_id:
        await init_schema_on_backend(session_id, form_id, total_fields)

    session = AgentSession(
        # STT through LiveKit Cloud inference gateway
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
        # LLM via direct OpenAI plugin (bypasses inference gateway for reliability)
        llm=openai.LLM(model="gpt-4o-mini"),
        # TTS via direct Deepgram plugin (bypasses inference gateway)
        tts=deepgram.TTS(
            model="aura-2-thalia-en",
            sample_rate=16000,  # Required for Anam avatar compatibility
        ),
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
        # Disable resume_false_interruption — DataStreamIO (Anam) does not support
        # pause(), so this would log warnings and contribute to instability on interrupts
        resume_false_interruption=False,
    )

    usage_collector = metrics.UsageCollector()

    @session.on("metrics_collected")
    def on_metrics_collected(ev: MetricsCollectedEvent) -> None:
        metrics.log_metrics(ev.metrics)
        usage_collector.collect(ev.metrics)

    async def log_usage():
        summary = usage_collector.get_summary()
        logger.info(f"Usage: {summary}")

    ctx.add_shutdown_callback(log_usage)

    # Track avatar session for cleanup
    avatar_session_ref: list[anam.AvatarSession] = []

    await session.start(
        agent=IntakeAssistant(ctx, schema, session_id=session_id),
        room=ctx.room,
        room_options=room_io.RoomOptions(
            audio_input=room_io.AudioInputOptions(
                noise_cancellation=lambda params: (
                    noise_cancellation.BVCTelephony()
                    if params.participant.kind
                    == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
                    else noise_cancellation.BVC()
                ),
            ),
        ),
    )

    # Anam avatar — lip-synced to TTS audio automatically
    # Avatar ID can be set from the UI (via participant metadata) or falls back to default
    DEFAULT_ANAM_AVATAR_ID = "290ef1d5-9201-40f4-8c88-394a6317f10d"  # Evelyn
    dynamic_avatar_id = get_anam_avatar_id_from_participant(ctx) or DEFAULT_ANAM_AVATAR_ID
    logger.info(f"Using Anam avatar ID: {dynamic_avatar_id}")
    avatar_config = anam.PersonaConfig(
        name="Avatar",
        avatarId=dynamic_avatar_id,
    )

    async def start_avatar() -> bool:
        """Start (or restart) the Anam avatar session. Returns True on success."""
        try:
            avatar = anam.AvatarSession(persona_config=avatar_config)
            await avatar.start(session, room=ctx.room)
            avatar_session_ref.clear()
            avatar_session_ref.append(avatar)
            logger.info(f"Anam avatar started successfully (session_id={avatar.session_id})")

            # Increase clear_buffer RPC timeout from default 2s to 5s.
            if hasattr(session.output, 'audio') and session.output.audio:
                session.output.audio._clear_buffer_timeout = 5.0
                logger.info("Increased clear_buffer_timeout to 5s for Anam stability")
            return True
        except Exception as e:
            logger.warning(f"Anam avatar failed to start (will continue without avatar): {e}")
            return False

    async def cleanup_avatar():
        """End the Anam session on shutdown so the next session starts fast."""
        if not avatar_session_ref:
            return
        avatar = avatar_session_ref[0]
        sid = avatar.session_id
        logger.info(f"Cleaning up Anam session {sid}")
        # Kick the Anam worker from the LiveKit room to force disconnect
        try:
            from livekit import api as lk_api
            lk = lk_api.LiveKitAPI()
            await lk.room.remove_participant(
                lk_api.RoomParticipantIdentity(
                    room=ctx.room.name,
                    identity="anam-avatar-agent",
                )
            )
            await lk.aclose()
            logger.info("Kicked Anam worker from room")
        except Exception as e:
            logger.debug(f"Could not kick Anam worker (may have already left): {e}")

    ctx.add_shutdown_callback(cleanup_avatar)

    avatar_ok = await start_avatar()

    # Monitor Anam worker participant — attempt one reconnection if it drops mid-session
    if avatar_ok:
        import asyncio
        avatar_reconnect_attempted = False

        def on_participant_disconnected(participant: rtc.RemoteParticipant):
            nonlocal avatar_reconnect_attempted
            if participant.identity.startswith("anam-") and not avatar_reconnect_attempted:
                # Only reconnect if a user is still in the room
                has_user = any(
                    not p.identity.startswith("anam-")
                    for p in ctx.room.remote_participants.values()
                    if p.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT
                )
                if not has_user:
                    logger.info("Anam worker left but no user in room — skipping reconnect")
                    return

                avatar_reconnect_attempted = True
                logger.warning(
                    f"Anam worker '{participant.identity}' disconnected — attempting reconnection"
                )

                async def _reconnect():
                    await asyncio.sleep(2)  # brief delay before retrying
                    reconnected = await start_avatar()
                    if reconnected:
                        logger.info("Anam avatar reconnected successfully")
                    else:
                        logger.warning("Anam avatar reconnection failed — audio-only mode")

                asyncio.create_task(_reconnect())

        ctx.room.on("participant_disconnected", on_participant_disconnected)

    logger.info("Session started, generating initial greeting reply")
    session.generate_reply(
        instructions="Use the defined opening line, then begin with the first field question."
    )
    logger.info("generate_reply() queued — waiting for LLM + TTS pipeline")


if __name__ == "__main__":
    cli.run_app(server)
