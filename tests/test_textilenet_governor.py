"""The governor that keeps long jobs from freezing the laptop. Pure logic, fake sensors."""

import subprocess
import sys

import pytest

from training.textilenet import governor as gv
from training.textilenet.governor import FAIR, NOMINAL, SERIOUS, Governor


class Fake:
    """Scripted sensors + a clock that advances only when the governor sleeps."""

    def __init__(self, thermal, free):
        self.thermal, self.free = list(thermal), list(free)
        self.now, self.slept, self.logs = 0.0, [], []

    def gov(self, **kw):
        return Governor(
            read_thermal=lambda: self.thermal.pop(0) if len(self.thermal) > 1 else self.thermal[0],
            read_free_pct=lambda: self.free.pop(0) if len(self.free) > 1 else self.free[0],
            sleep=self._sleep,
            clock=lambda: self.now,
            log=self.logs.append,
            **kw,
        )

    def _sleep(self, s):
        self.slept.append(s)
        self.now += s


def test_cool_and_roomy_means_no_pause():
    f = Fake([NOMINAL], [80])
    f.gov().pause_if_needed()
    assert f.slept == []


def test_fair_thermal_takes_a_short_rest():
    f = Fake([FAIR], [80])
    f.gov(fair_sleep_s=1.5).pause_if_needed()
    assert f.slept == [1.5]


def test_serious_thermal_pauses_until_back_to_fair():
    f = Fake([SERIOUS, SERIOUS, FAIR], [80])
    g = f.gov(poll_s=30)
    g.pause_if_needed()
    assert f.slept == [30, 30]
    assert g.paused_s == 60
    assert "pausing" in f.logs[0] and "resuming" in f.logs[-1]


def test_low_memory_pauses_with_hysteresis():
    # 20% < 25% pauses; 30% is not yet the 35% resume level; 36% resumes.
    f = Fake([NOMINAL], [20, 30, 36])
    f.gov(min_free_pct=25, resume_free_pct=35, poll_s=10).pause_if_needed()
    assert f.slept == [10, 10]


def test_sensors_are_read_at_most_once_per_interval():
    reads = []
    g = Governor(
        read_thermal=lambda: reads.append(1) or NOMINAL,
        read_free_pct=lambda: 90,
        sleep=lambda s: None,
        clock=lambda: 5.0,
        check_every_s=10,
    )
    g.pause_if_needed()
    g.pause_if_needed()
    assert len(reads) == 1


def test_off_macos_thermal_reads_nominal(monkeypatch):
    monkeypatch.setattr(gv.platform, "system", lambda: "Linux")
    assert gv.thermal_state() == NOMINAL


def test_mps_memory_cap_is_accepted_by_torch():
    # The package sets PYTORCH_MPS_*_WATERMARK_RATIO on import; an inconsistent pair
    # (low above high) makes every MPS allocation raise. Skipped off Apple GPUs.
    torch = pytest.importorskip("torch")
    if not torch.backends.mps.is_available():
        pytest.skip("no MPS device")
    code = (
        "import training.textilenet, torch;"
        "assert torch.backends.mps.is_available();"
        "torch.ones(4, device='mps').sum().item()"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-400:]
