import os
import sqlite3
import threading
import time
from typing import Literal, List, Dict

Role = Literal["user", "assistant"]


class ChatMemory:
    """Tiny SQLite-backed chat memory keyed by session_id."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at REAL NOT NULL
            )
            """
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages(session_id, created_at)"
        )
        self._conn.commit()

    def add(self, session_id: str, role: Role, content: str) -> None:
        if not content:
            return
        with self._lock:
            self._conn.execute(
                "INSERT INTO messages(session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, role, content, time.time()),
            )
            self._conn.commit()

    def recent(self, session_id: str, limit: int = 12) -> List[Dict[str, str]]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT role, content
                FROM messages
                WHERE session_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (session_id, limit),
            ).fetchall()
        rows.reverse()
        return [{"role": r[0], "content": r[1]} for r in rows]

    def clear(self, session_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            self._conn.commit()


def default_memory() -> ChatMemory:
    base_dir = os.environ.get("CHAT_DATA_DIR") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "data"
    )
    db_path = os.environ.get("CHAT_DB_PATH") or os.path.join(base_dir, "chat.db")
    return ChatMemory(db_path=db_path)

