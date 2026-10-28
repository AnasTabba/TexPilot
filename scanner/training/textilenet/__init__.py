# Metal memory caps, MPS fallback and quiet albumentations, set before torch loads.
# One definition for serving and training: services/vision/runtime.py.
from services.vision import runtime  # noqa: F401
