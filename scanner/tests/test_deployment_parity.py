"""The Modal recipe must serve what `make api-scanner` serves. Static; no modal, no models/."""

import ast
import re
from pathlib import Path

SCANNER = Path(__file__).resolve().parents[1]
RECIPE = SCANNER / "deployment/modal_scanner.py"


def _recipe():
    """(env dict, [(local path under ROOT, image path, kwargs)]) read from the recipe's AST."""
    tree = ast.parse(RECIPE.read_text())
    env, copies = {}, []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr == "env" and node.args:
            env.update(ast.literal_eval(node.args[0]))
        elif node.func.attr in ("add_local_dir", "add_local_file"):
            src = ast.unparse(node.args[0])  # ROOT / "models/custom"
            m = re.fullmatch(r"ROOT / ['\"](.+)['\"]", src)
            assert m, f"unexpected source expression: {src}"
            kw = {k.arg: ast.unparse(k.value) for k in node.keywords}
            copies.append((m.group(1), ast.literal_eval(node.args[1]), kw))
    return env, copies


def _served_by_make():
    """TEXPILOT_* model-path variables of the api-scanner recipe, plus the config defaults."""
    text = (SCANNER / "Makefile").read_text()
    recipe = text.split("api-scanner:", 1)[1].split("\n\n", 1)[0]
    served = dict(re.findall(r"(TEXPILOT_\w+)=(models/\S+)", recipe))
    served.setdefault("TEXPILOT_MODEL_BUNDLE", "models/scanner-v8")  # config.py default
    served.setdefault("TEXPILOT_CUSTOM_HEADS", "models/custom")  # heads.py default
    return served


def test_every_served_model_folder_is_in_env_and_image():
    env, copies = _recipe()
    served = _served_by_make()
    assert "TEXPILOT_FAULT_MODEL" in served  # the Makefile really serves the fault model
    for var, folder in served.items():
        assert var in env, f"{var} not set in the Modal env"
        assert env[var] == f"/app/{folder}", f"{var}={env[var]!r}, expected /app/{folder}"
        assert any(src == folder and dst == env[var] for src, dst, _ in copies), (
            f"{folder} is not copied to {env[var]}"
        )


def test_fault_model_copy_keeps_encoder_weights():
    # The DINOv2 encoder (Dinomaly/backbones/weights/*.pth) must ship: no ignore may drop it.
    _, copies = _recipe()
    (kw,) = [k for src, _, k in copies if src == "models/fault-wfdd-v1"]
    ignore = kw.get("ignore", "")
    assert ".pth" not in ignore and "weights" not in ignore and ".pt" not in ignore


def test_fault_code_is_copied():
    _, copies = _recipe()
    srcs = {src for src, _, _ in copies}
    assert {
        "training/__init__.py",
        "training/fault/__init__.py",
        "training/fault/methods",
    } <= srcs
    assert not any("kaggle" in s for s in srcs)


def test_third_party_imports_of_fault_model_are_pinned():
    # models/ is gitignored, so the list is fixed: what Dinomaly/utils.py and the encoder import.
    pins = {
        line.split("==")[0].strip().lower()
        for line in (SCANNER / "deployment/requirements-serving.txt").read_text().splitlines()
        if "==" in line and not line.startswith("#")
    }
    needed = [
        "scikit-learn",
        "scikit-image",
        "matplotlib",
        "pandas",
        "scipy",
        "timm",
        "opencv-python-headless",
    ]
    assert [p for p in needed if p not in pins] == []
