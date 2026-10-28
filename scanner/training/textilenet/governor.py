"""Keep long jobs from overheating or starving this laptop.

On 2026-09-27 the DINOv2 probe (2.2 GB, plus six 0.3 GB loader workers) ran next to
~2 GB of browser tabs on the team's fanless 16 GB MacBook Air. Memory ran out, the
machine thrashed, froze and had to be force-restarted. Long loops now call
``Governor.pause_if_needed()`` between batches:

* thermal state FAIR    -> a short rest each check, so heat can shed;
* thermal state SERIOUS+ -> pause until it is back to FAIR;
* free memory < 25%     -> pause until 35% is free again (hysteresis, no flapping).

Sensors are macOS's own (``NSProcessInfo.thermalState``, ``kern.memorystatus_level``)
and need no admin rights. Elsewhere, or if a sensor fails, they read as healthy: a
missing sensor must not stop a cloud GPU run.
"""

from __future__ import annotations

import platform
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

NOMINAL, FAIR, SERIOUS, CRITICAL = range(4)
_NAMES = ("nominal", "fair", "serious", "critical")


def thermal_state() -> int:
    """macOS thermal pressure, 0 (nominal) .. 3 (critical); NOMINAL off macOS."""
    if platform.system() != "Darwin":
        return NOMINAL
    js = 'ObjC.import("Foundation"); $.NSProcessInfo.processInfo.thermalState'
    try:
        out = subprocess.run(
            ["osascript", "-l", "JavaScript", "-e", js], capture_output=True, text=True, timeout=5
        ).stdout
        return min(max(int(out.strip()), NOMINAL), CRITICAL)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return NOMINAL


def memory_free_pct() -> int:
    """System-wide free memory, percent; 100 if unknown."""
    try:
        if platform.system() == "Darwin":
            out = subprocess.run(
                ["sysctl", "-n", "kern.memorystatus_level"],
                capture_output=True,
                text=True,
                timeout=5,
            ).stdout
            return int(out.strip())
        info = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
        total = int(info["MemTotal"].split()[0])
        return int(100 * int(info["MemAvailable"].split()[0]) / total)
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
        return 100


@dataclass
class Governor:
    min_free_pct: int = 25
    resume_free_pct: int = 35
    fair_sleep_s: float = 1.0
    poll_s: float = 30.0
    check_every_s: float = 10.0
    read_thermal: Callable[[], int] = thermal_state
    read_free_pct: Callable[[], int] = memory_free_pct
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    log: Callable[[str], None] = print
    paused_s: float = field(default=0.0, init=False)
    _last_check: float | None = field(default=None, init=False)

    def pause_if_needed(self) -> None:
        now = self.clock()
        if self._last_check is not None and now - self._last_check < self.check_every_s:
            return
        self._last_check = now

        thermal, free = self.read_thermal(), self.read_free_pct()
        if thermal <= FAIR and free >= self.min_free_pct:
            if thermal == FAIR:
                self.sleep(self.fair_sleep_s)
                self.paused_s += self.fair_sleep_s
            return

        self.log(f"governor: pausing (thermal {_NAMES[thermal]}, {free}% memory free)")
        start = self.clock()
        while True:
            self.sleep(self.poll_s)
            thermal, free = self.read_thermal(), self.read_free_pct()
            if thermal <= FAIR and free >= self.resume_free_pct:
                break
        waited = self.clock() - start
        self.paused_s += waited
        self.log(
            f"governor: resuming after {waited:.0f}s (thermal {_NAMES[thermal]}, {free}% free)"
        )
        self._last_check = self.clock()
