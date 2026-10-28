"""Local scheduler gate: skip model launches until active work can resume."""
import json
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
if not (root / "ACTIVE").exists():
    raise SystemExit(1)
state = json.loads((root / "coordination-state.json").read_text())
resume_at = state.get("resume_not_before")
if resume_at and datetime.now(timezone.utc) < datetime.fromisoformat(resume_at):
    raise SystemExit(1)
raise SystemExit(0)
