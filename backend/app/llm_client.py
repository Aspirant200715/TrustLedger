"""Single, hardened LLM provider boundary for TrustLedger."""
import asyncio
import json
import os

from dotenv import load_dotenv
from groq import AsyncGroq, GroqError
from pydantic import BaseModel, ValidationError

load_dotenv()

MODEL = "qwen/qwen3.8-27b"
LLM_TIMEOUT_SECONDS = 3.8
_client: AsyncGroq | None = None


class LLMUnavailableError(RuntimeError):
    """Safe provider failure consumed by the orchestrator.

    The public message is intentionally stable and contains no provider
    response body, credential material, or quota/account details.
    """

    code = "LLM_UNAVAILABLE"


def validate_api_key() -> None:
    """Fail backend startup when the required key is absent."""
    if not os.environ.get("LLM_API_KEY", "").strip():
        raise RuntimeError(
            "LLM_API_KEY is required. Add it to the repository-root .env "
            "before starting TrustLedger."
        )


def get_client() -> AsyncGroq:
    global _client
    validate_api_key()
    if _client is None:
        _client = AsyncGroq(api_key=os.environ["LLM_API_KEY"])
    return _client


def _flatten_schema(schema: dict) -> dict:
    defs = schema.get("$defs", {})

    def resolve(obj):
        if isinstance(obj, dict):
            if "$ref" in obj:
                return resolve(defs.get(obj["$ref"].split("/")[-1], obj))
            return {k: resolve(v) for k, v in obj.items() if k != "$defs"}
        if isinstance(obj, list):
            return [resolve(i) for i in obj]
        return obj

    flat = resolve(schema)
    flat.pop("$defs", None)
    flat.pop("title", None)
    if "properties" in flat and "type" not in flat:
        flat["type"] = "object"
    return flat


async def get_structured_completion(
    system_prompt: str,
    user_prompt: str,
    response_model: type[BaseModel],
) -> BaseModel:
    """Request and validate structured output, retrying malformed output once.

    Missing/invalid keys, quota/provider errors and timeouts are normalized to
    LLMUnavailableError so no provider exception or secret crosses this module.
    """
    schema = _flatten_schema(response_model.model_json_schema())
    validation_error: Exception | None = None

    for attempt in range(2):
        retry_note = ""
        if attempt:
            retry_note = "\n\nReturn valid structured data matching the supplied schema exactly."
        try:
            response = await asyncio.wait_for(
                get_client().chat.completions.create(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt + retry_note},
                    ],
                    tools=[{
                        "type": "function",
                        "function": {
                            "name": "return_structured_data",
                            "description": "Return the final structured response.",
                            "parameters": schema,
                        },
                    }],
                    tool_choice={"type": "function", "function": {"name": "return_structured_data"}},
                ),
                timeout=LLM_TIMEOUT_SECONDS,
            )
        except (asyncio.TimeoutError, GroqError, OSError) as exc:
            raise LLMUnavailableError("AI provider is unavailable") from exc

        try:
            for call in response.choices[0].message.tool_calls or []:
                if call.function.name == "return_structured_data":
                    return response_model.model_validate_json(call.function.arguments)
            validation_error = ValueError("structured tool call missing")
        except (ValidationError, ValueError, TypeError, json.JSONDecodeError) as exc:
            validation_error = exc

    raise LLMUnavailableError("AI provider returned invalid structured data") from validation_error
