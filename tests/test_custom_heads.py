"""A factory teaches the scanner its own categories (e.g. wash types) from labelled photo
folders: a small head on the Head A encoder's features. Tiny untrained encoder; no downloads."""

import json

import pytest

np = pytest.importorskip("numpy")
torch = pytest.importorskip("torch")
pytest.importorskip("timm")
pytest.importorskip("sklearn")
Image = pytest.importorskip("PIL.Image")

from services.vision import heads  # noqa: E402
from services.vision.custom import load_custom_heads  # noqa: E402
from services.vision.heads import FineTunedHead, timm_classifier  # noqa: E402
from training.scanner.teach import teach  # noqa: E402

CPU = torch.device("cpu")


@pytest.fixture
def head_a(tmp_path, monkeypatch):
    """A probe Head A (frozen encoder + linear layer) on a tiny random CNN."""
    from safetensors.numpy import save_file

    torch.manual_seed(0)
    encoder = timm_classifier("resnet10t", 0, 64)
    monkeypatch.setattr(heads, "timm_classifier", lambda *a, **k: encoder)
    d = tmp_path / "head_a"
    d.mkdir()
    probe = torch.nn.Linear(encoder.num_features, 3)
    save_file({f"probe.{k}": v.detach().numpy() for k, v in probe.state_dict().items()},
              str(d / "probe.safetensors"))  # fmt: skip
    meta = dict(classes=["canvas", "denim", "lace"], timm_name="resnet10t", img_size=64)
    meta |= dict(crop_pct=0.875, mean=[0.5] * 3, std=[0.5] * 3, temperature=1.0, threshold=0.5)
    (d / "head.json").write_text(json.dumps(meta | {"pool": "probe"}))
    return FineTunedHead(d, CPU)


def photo(light: bool, seed: int) -> np.ndarray:
    """Denim-blue swatches: a light (heavily washed) one or a dark (rinsed) one."""
    rng = np.random.default_rng(seed)
    base = np.array([150, 170, 210] if light else [25, 35, 80], float)
    img = base + rng.normal(0, 25, (96, 96, 3))
    return np.clip(img, 0, 255).astype(np.uint8)


def folders(root, n_light=12, n_dark=12):
    for name, light, n in [("stone_wash", True, n_light), ("rinse", False, n_dark)]:
        (root / name).mkdir(parents=True)
        for i in range(n):
            Image.fromarray(photo(light, seed=i + 100 * light)).save(root / name / f"{i}.jpg")
    return root


def test_teaching_from_folders_reports_cross_validated_accuracy_and_then_answers(tmp_path, head_a):
    custom, report = teach(folders(tmp_path / "wash"), head_a, "wash")
    assert custom.classes == ("rinse", "stone_wash")
    assert report["cv_accuracy"] >= 0.9 and report["photos"] == {"rinse": 12, "stone_wash": 12}
    f = head_a.features([photo(True, seed=999)])
    out = custom.predict(f)
    assert out is not None and out.label == "stone_wash"


def test_a_class_with_too_few_photos_is_refused(tmp_path, head_a):
    with pytest.raises(ValueError, match="10 photos"):
        teach(folders(tmp_path / "wash", n_light=5), head_a, "wash")


def test_a_taught_head_cannot_take_a_built_in_heads_name(tmp_path, head_a):
    with pytest.raises(ValueError, match="built-in"):
        teach(folders(tmp_path / "wash"), head_a, "structure")


def test_saved_heads_load_only_for_the_encoder_they_were_taught_on(tmp_path, head_a):
    custom, _ = teach(folders(tmp_path / "wash"), head_a, "wash")
    custom.save(tmp_path / "custom")
    (loaded,) = load_custom_heads(tmp_path / "custom", "resnet10t")
    assert loaded.name == "wash" and loaded.classes == custom.classes
    f = head_a.features([photo(False, seed=7)])
    assert np.allclose(loaded.probs(f), custom.probs(f))
    assert load_custom_heads(tmp_path / "custom", "vit_so400m_patch14_siglip_224") == []
    assert load_custom_heads(tmp_path / "nothing-here", "resnet10t") == []


def test_heads_taught_on_a_tuned_encoder_do_not_load_on_its_public_base(tmp_path, head_a):
    head_a.meta["encoder_id"] = "resnet10t+lora-1234abcd"
    custom, _ = teach(folders(tmp_path / "wash"), head_a, "wash")
    custom.save(tmp_path / "custom")
    assert custom.encoder == "resnet10t+lora-1234abcd"
    assert load_custom_heads(tmp_path / "custom", "resnet10t") == []
    assert [h.name for h in load_custom_heads(tmp_path / "custom", head_a.encoder_id)] == ["wash"]


def test_head_a_features_give_the_same_answer_as_its_own_probs(head_a):
    views = [photo(True, 1), photo(False, 2)]
    assert np.allclose(head_a.probs_from_features(head_a.features(views)), head_a.probs(views))


def test_a_scan_reports_a_taught_head_next_to_the_fabric_from_one_encoder_pass(
    tmp_path, head_a, monkeypatch
):
    from services.vision.heads import LinearHeads

    custom, _ = teach(folders(tmp_path / "wash"), head_a, "wash")
    lh = LinearHeads.__new__(LinearHeads)  # the bundle's own backbone is not needed here
    lh.specs, lh.structure_model, lh.custom = {}, head_a, [custom]
    lh.mean, lh.std, lh.img_size, lh.crop_pct = [0.5] * 3, [0.5] * 3, 64, 0.875
    lh.device, lh._torch, lh.half, lh.model = CPU, torch, False, head_a.model
    passes = []
    run = head_a._run
    monkeypatch.setattr(head_a, "_run", lambda fn, views: passes.append(1) or run(fn, views))
    out = lh.predict([photo(True, seed=5)])
    assert out.custom["wash"].label == "stone_wash"
    assert out.structure is None or out.structure.label in head_a.classes
    assert len(passes) == 1  # Head A and the taught head share one pass through the encoder


def test_heads_taught_on_an_earlier_head_a_keep_answering_after_an_upgrade(
    tmp_path, head_a, monkeypatch
):
    from services.vision.heads import LinearHeads

    head_a.meta["encoder_id"] = "resnet10t+lora-old"
    custom, _ = teach(folders(tmp_path / "wash"), head_a, "wash")
    new_a = FineTunedHead(tmp_path / "head_a", CPU)
    new_a.meta["encoder_id"] = "resnet10t+lora-new"
    lh = LinearHeads.__new__(LinearHeads)
    lh.specs, lh.structure_model, lh.custom, lh.custom_encoder = {}, new_a, [custom], head_a
    lh.mean, lh.std, lh.img_size, lh.crop_pct = [0.5] * 3, [0.5] * 3, 64, 0.875
    lh.device, lh._torch, lh.half, lh.model = CPU, torch, False, new_a.model
    passes = []
    for h in (head_a, new_a):
        count = lambda fn, views, run=h._run, who=h: passes.append(who) or run(fn, views)  # noqa: E731
        monkeypatch.setattr(h, "_run", count)
    out = lh.predict([photo(True, seed=5)])
    assert out.custom["wash"].label == "stone_wash"
    assert passes == [new_a, head_a]  # the old encoder costs one more pass
    assert "taught_model" in out.timings_ms


def test_the_api_returns_taught_heads_answers_and_abstentions():
    from services.api.pipeline import run_scan
    from services.vision.predictor import HeadOutput, VisionOutput

    class Predictor:
        def predict(self, _):
            wash = HeadOutput("stone_wash", 0.93, [("stone_wash", 0.93), ("rinse", 0.07)])
            return VisionOutput(None, None, None, custom={"wash": wash, "finish": None})

    r = run_scan(Predictor(), b"x")
    assert r.custom["wash"].label == "stone_wash" and r.custom["finish"] is None
