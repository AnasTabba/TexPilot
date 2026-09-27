"""Errors the API maps to HTTP responses. Stdlib only, so the API imports it cheaply."""


class UnsupportedImage(ValueError):
    """The upload is not an image we can decode (HEIC, truncated, not an image at all)."""
