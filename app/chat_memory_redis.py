import time
import json
from typing import Literal, List, Dict
import redis.asyncio as redis
from structlog import get_logger

logger = get_logger("chat_memory_redis")

Role = Literal["user", "assistant"]


class ChatMemoryRedis:
    """Redis-backed chat memory (scalable, distributed)."""

    def __init__(self, rdb: redis.Redis, ttl_hours: int = 24):
        self.rdb = rdb
        self.ttl = ttl_hours * 3600  # seconds
        self.prefix = "chat:msg:"

    async def add(self, session_id: str, role: Role, content: str) -> None:
        if not content.strip():
            return
        key = f"{self.prefix}{session_id}"
        ts = time.time()
        msg = {"role": role, "content": content, "ts": ts}
        # LPUSH + expire (recent first)
        await self.rdb.lpush(key, json.dumps(msg))
        await self.rdb.expire(key, self.ttl)
        logger.debug("Chat msg added", session_id=session_id[:8], role=role)

    async def recent(self, session_id: str, limit: int = 12) -> List[Dict[str, str]]:
        key = f"{self.prefix}{session_id}"
        msgs = await self.rdb.lrange(key, 0, limit - 1)
        rows = []
        for raw in msgs:
            try:
                msg = json.loads(raw)
                rows.append({"role": msg["role"], "content": msg["content"]})
            except (json.JSONDecodeError, KeyError):
                continue
        rows.reverse()  # oldest first for LLM
        return rows

    async def clear(self, session_id: str) -> None:
        key = f"{self.prefix}{session_id}"
        await self.rdb.delete(key)
        logger.debug("Chat session cleared", session_id=session_id[:8])


async def default_memory_redis(rdb_client: redis.Redis):
    return ChatMemoryRedis(rdb_client)

