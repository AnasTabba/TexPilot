import os

# albumentations checks PyPI for a newer release on every import -- once per DataLoader
# worker. That is a network call per worker and a warning whenever it fails; turn it off.
os.environ.setdefault("NO_ALBUMENTATIONS_UPDATE", "1")

# Cap PyTorch's Metal (MPS) memory at half the recommended working set (~5 GB of 16 GB):
# a runaway job then fails with an out-of-memory error instead of dragging the whole
# laptop into swap until it freezes (which is what happened on 2026-09-27).
os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.5")
