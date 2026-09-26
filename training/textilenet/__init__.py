import os

# albumentations checks PyPI for a newer release on every import -- once per DataLoader
# worker. That is a network call per worker and a warning whenever it fails; turn it off.
os.environ.setdefault("NO_ALBUMENTATIONS_UPDATE", "1")
