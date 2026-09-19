import os
import redis.asyncio as redis
from dotenv import load_dotenv

# Load the repository-level .env before reading connection settings.
# python-dotenv walks parent directories, so this works when uvicorn starts
# from backend/ as well as from the repository root.
load_dotenv()

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
redis_client = None

async def get_redis() -> redis.Redis:
    global redis_client
    if redis_client is None:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    return redis_client
