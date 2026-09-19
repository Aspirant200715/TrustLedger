import os
import json
from pydantic import BaseModel
from groq import AsyncGroq
from dotenv import load_dotenv

load_dotenv()

# The Groq client is built lazily on first use. Constructing it at import time
# would raise GroqError when LLM_API_KEY is unset, which would take down the
# whole backend (every route, not just LLM ones) before it could serve a
# request. Deferring means a missing key degrades to the orchestrator's
# escalation fallback instead of a dead server.
_client: AsyncGroq | None = None


def get_client() -> AsyncGroq:
    global _client
    if _client is None:
        api_key = os.environ.get("LLM_API_KEY")
        if not api_key:
            raise RuntimeError(
                "LLM_API_KEY is not set — add it to the repo-root .env "
                "(see .env.example). Disputes will escalate to human review "
                "until a key is configured."
            )
        _client = AsyncGroq(api_key=api_key)
    return _client


def _flatten_schema(schema: dict) -> dict:
    """
    Groq's qwen model chokes on Pydantic schemas that use $defs + $ref.
    This helper resolves all $ref references inline so the schema is flat
    and every enum becomes a plain {"type": "string", "enum": [...]}.
    """
    defs = schema.get("$defs", {})

    def resolve(obj):
        if isinstance(obj, dict):
            if "$ref" in obj:
                ref_name = obj["$ref"].split("/")[-1]
                return resolve(defs.get(ref_name, obj))
            return {k: resolve(v) for k, v in obj.items() if k != "$defs"}
        if isinstance(obj, list):
            return [resolve(i) for i in obj]
        return obj

    flat = resolve(schema)
    flat.pop("$defs", None)
    flat.pop("title", None)
    # Ensure top-level has type: object
    if "properties" in flat and "type" not in flat:
        flat["type"] = "object"
    return flat


async def get_structured_completion(
    system_prompt: str,
    user_prompt: str,
    response_model: type[BaseModel],
) -> BaseModel:
    raw_schema = response_model.model_json_schema()
    schema = _flatten_schema(raw_schema)

    response = await get_client().chat.completions.create(
        model="qwen/qwen3.8-27b",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        tools=[
            {
                "type": "function",
                "function": {
                    "name": "return_structured_data",
                    "description": "Return the final structured response.",
                    "parameters": schema,
                },
            }
        ],
        tool_choice={"type": "function", "function": {"name": "return_structured_data"}},
    )

    tool_calls = response.choices[0].message.tool_calls
    if tool_calls:
        for tool_call in tool_calls:
            if tool_call.function.name == "return_structured_data":
                return response_model.model_validate_json(tool_call.function.arguments)

    raise ValueError("LLM failed to return structured data via tool call")
