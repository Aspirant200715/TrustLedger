from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .redis_client import get_redis
import redis.asyncio as redis

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health_check(redis_client: redis.Redis = Depends(get_redis)):
    try:
        await redis_client.ping()
        return {"status": "ok"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={"error": "Service Unavailable", "detail": "Could not connect to Redis"}
        )

from .synthetic_data import generate_dispute

@app.get("/api/dev/generate-sample")
async def generate_sample():
    """DEV ONLY: Generate 5 sample disputes to test the synthetic data generator."""
    samples = []
    for _ in range(5):
        dispute, mock_ledger = generate_dispute()
        samples.append({
            "dispute": dispute.model_dump(mode="json"),
            "mock_ledger_state": mock_ledger
        })
    return {"samples": samples}
