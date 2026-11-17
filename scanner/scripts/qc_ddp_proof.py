"""Mandatory numerical + separate production-loop DDP proof (plan T10, external G6).

No torch import, upstream clone, download, training launch or GPU allocation occurs here.
An authorized owner must supply existing local artifacts. The numerical subprocess executes
the named real two-rank test with DINOMALY_REPO set; a successful pytest exit alone is not
proof because pytest also exits zero for skipped tests. JUnit must show that exact test passed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

SCANNER = Path(__file__).resolve().parents[1]
NUMERICAL_TEST = (
    "tests/test_fault_dinomaly_ddp.py::"
    "test_two_rank_gradients_and_three_updates_match_upstream_global_batch"
)


class DDPProofError(RuntimeError):
    """Missing or invalid proof is an external G6 failure, never a skip/pass."""


def _require(condition, message):
    if not condition:
        raise DDPProofError(f"external gate G6: {message}")


def _hash(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def _positive(value):
    return type(value) in (int, float) and math.isfinite(value) and value > 0


def _hardware_report(record, expected_sha):
    _require(record.get("upstream_sha") == expected_sha, "hardware report upstream SHA mismatch")
    _require(
        isinstance(record.get("source_commit"), str)
        and re.fullmatch(r"[0-9a-f]{40}", record["source_commit"]) is not None
        and _hash(record.get("dirty_patch_sha256"))
        and _hash(record.get("environment_lock_sha256")),
        "production source commit/patch/environment lock not pinned",
    )
    _require(record.get("production_loop") is True, "real production-loop report not collected")
    _require(
        record.get("backend") == "nccl"
        and record.get("amp") is True
        and record.get("world_size") == 2
        and record.get("optimizer") == "StableAdamW",
        "report must prove two-rank production StableAdamW/AMP/NCCL execution",
    )
    _require(
        all(record.get(k) for k in ("commands", "hardware", "driver")),
        "report lacks exact command/hardware/driver",
    )
    _require(
        all(
            str(record[k]).strip().casefold()
            not in ("unknown", "not yet collected", "unavailable", "none", "n/a", "pending")
            for k in ("hardware", "driver")
        ),
        "measured hardware/driver report not yet collected",
    )
    _require(
        isinstance(record["commands"], list)
        and all(isinstance(c, str) and c.strip() for c in record["commands"]),
        "invalid report commands",
    )
    successful, attempted, skipped = (
        record.get(k) for k in ("steps_successful", "steps_attempted", "steps_skipped")
    )
    _require(
        all(type(v) is int and v >= 0 for v in (successful, attempted, skipped))
        and successful > 0
        and attempted == successful + skipped,
        "report lacks successful/attempted/skipped optimizer-step proof",
    )
    batch, local = record.get("global_batch"), record.get("per_rank_batch")
    _require(
        type(batch) is int and type(local) is int and local > 0 and batch == 2 * local,
        "report global/per-rank batches are incompatible",
    )
    _require(_positive(record.get("wall_time_s")), "measured production wall time missing")
    losses, peaks = record.get("losses"), record.get("peak_memory_bytes")
    _require(
        isinstance(losses, list)
        and losses
        and all(type(v) in (int, float) and math.isfinite(v) for v in losses),
        "finite losses missing",
    )
    _require(
        isinstance(peaks, list) and len(peaks) == 2 and all(map(_positive, peaks)),
        "both-rank peak memory measurements missing",
    )
    hashes = record.get("checkpoint_sha256s")
    _require(
        isinstance(hashes, list) and hashes and all(map(_hash, hashes)), "checkpoint hashes missing"
    )
    ranks = record.get("ranks")
    _require(
        isinstance(ranks, list) and len(ranks) == 2 and all(isinstance(r, dict) for r in ranks),
        "both-rank utilization measurements missing",
    )
    _require({r.get("rank") for r in ranks} == {0, 1}, "rank counters missing")
    devices = [r.get("device_uuid") for r in ranks]
    _require(
        all(isinstance(d, str) and d.strip() for d in devices) and len(set(devices)) == 2,
        "two distinct measured devices required",
    )
    _require(
        all(
            _positive(r.get("utilization_percent"))
            and r["utilization_percent"] <= 100
            and r.get("steps_successful") == successful
            for r in ranks
        ),
        "both-device utilization and successful update counters required",
    )
    if record.get("speedup_claimed"):
        _require(
            _positive(record.get("single_rank_loop_s"))
            and _positive(record.get("two_rank_loop_s")),
            "speedup requires separately measured matched single/two-rank loop times",
        )


def verify_ddp_proof(upstream: Path, expected_sha: str, report: Path) -> None:
    """Raise G6 on missing/mismatched upstream, missing hardware proof or skipped numerical test.

    The clean checkout must be the upstream pinned by the real bundle (the CLI checks that
    binding). The hardware report remains distinct from this small Gloo gradient regression;
    this checker does not infer real utilization or speedup from a CPU test.
    """
    try:
        upstream, report = Path(upstream).resolve(), Path(report)
        _require(
            isinstance(expected_sha, str)
            and re.fullmatch(r"[0-9a-f]{40}", expected_sha) is not None,
            "pinned upstream commit SHA not yet collected",
        )
        _require(
            upstream.is_dir() and (upstream / "utils.py").is_file(),
            "real upstream checkout/loss not yet collected",
        )
        _require(report.is_file(), "real production-loop hardware report not yet collected")
        for command in (("rev-parse", "HEAD"), ("status", "--porcelain", "--untracked-files=all")):
            result = subprocess.run(
                ["git", "-C", str(upstream), *command],
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )
            _require(result.returncode == 0, "cannot verify actual upstream checkout")
            _require(
                result.stdout.strip() == (expected_sha if command[0] == "rev-parse" else ""),
                "actual upstream SHA mismatch or dirty upstream checkout",
            )
        record = json.loads(report.read_text())
        _require(isinstance(record, dict), "hardware report must be a JSON object")
        _hardware_report(record, expected_sha)
        with tempfile.TemporaryDirectory(prefix="qc-ddp-proof-") as folder:
            junit = Path(folder) / "numerical.xml"
            env = dict(
                os.environ, DINOMALY_REPO=str(upstream), OMP_NUM_THREADS="1", PYTEST_ADDOPTS=""
            )
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    NUMERICAL_TEST,
                    "-q",
                    "-o",
                    "addopts=",
                    f"--junitxml={junit}",
                ],
                cwd=SCANNER,
                env=env,
                capture_output=True,
                text=True,
                check=False,
                timeout=300,
            )
            _require(
                result.returncode == 0, "named two-rank numerical test failed or could not run"
            )
            _require(junit.is_file(), "numerical execution report missing")
            root = ET.parse(junit).getroot()
            cases = root.findall(".//testcase")
            _require(
                len(cases) == 1
                and cases[0].get("name") == NUMERICAL_TEST.split("::")[1]
                and cases[0].get("classname") == "tests.test_fault_dinomaly_ddp",
                "named numerical test did not execute exactly once",
            )
            _require(
                not any(root.findall(f".//{tag}") for tag in ("skipped", "failure", "error")),
                "numerical test was skipped or failed; executed proof is mandatory",
            )
    except DDPProofError:
        raise
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        ET.ParseError,
        subprocess.SubprocessError,
    ) as exc:
        raise DDPProofError(
            f"external gate G6: proof could not be verified ({type(exc).__name__})"
        ) from exc


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        _require(
            args.manifest.is_file(),
            "DDP proof manifest not yet collected; upstream, bundle "
            "and real production-loop hardware report are absent",
        )
        manifest = json.loads(args.manifest.read_text())
        # Relative artifact paths are relative to scanner/, matching the documented command.
        bundle_path = SCANNER / manifest["bundle_manifest"]
        raw = bundle_path.read_bytes()
        _require(
            _hash(manifest["bundle_manifest_sha256"])
            and hashlib.sha256(raw).hexdigest() == manifest["bundle_manifest_sha256"],
            "bundle manifest hash mismatch",
        )
        bundle = json.loads(raw)
        expected = manifest["expected_sha"]
        _require(bundle["upstream_sha"] == expected, "upstream pin differs from the real bundle")
        weights = bundle_path.parent / bundle["weights_file"]
        _require(
            _hash(bundle["weights_sha256"])
            and weights.is_file()
            and hashlib.sha256(weights.read_bytes()).hexdigest() == bundle["weights_sha256"],
            "real bundle weights absent or hash mismatch",
        )
        report = SCANNER / manifest["report"]
        _require(
            _hash(manifest["report_sha256"])
            and hashlib.sha256(report.read_bytes()).hexdigest() == manifest["report_sha256"],
            "hardware report hash mismatch",
        )
        production = json.loads(report.read_bytes())
        for key in ("source_commit", "dirty_patch_sha256", "environment_lock_sha256"):
            _require(
                bundle[key] == production[key],
                "production report source/environment differs from bundle",
            )
        verify_ddp_proof(SCANNER / manifest["upstream"], expected, report)
    except (DDPProofError, OSError, ValueError, TypeError, KeyError) as exc:
        print(f"G6 DDP proof FAILED: {exc}", file=sys.stderr)
        return 1
    print(
        "Pinned numerical test executed without skip; separate production report verified. "
        "This does not authorize release or infer a speedup."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
