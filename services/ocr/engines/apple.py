"""Apple Vision text recognition via PyObjC. Spec §5.1, engine 2. macOS only."""

from __future__ import annotations

import io

from services.ocr.engines.base import TextLine

LANGUAGES = ("en-US", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR")


def vision_box_to_pixels(
    x: float, y: float, w: float, h: float, width: float, height: float
) -> tuple[float, float, float, float]:
    """Vision boxes are normalised with the origin bottom-left; ours are pixels, top-left."""
    return (x * width, (1 - y - h) * height, (x + w) * width, (1 - y) * height)


class AppleVisionEngine:
    name = "apple"

    def __init__(self, languages: tuple[str, ...] = LANGUAGES):
        import numpy as np
        import Quartz
        import Vision
        from Foundation import NSData

        self._quartz, self._vision, self._nsdata = Quartz, Vision, NSData
        self.languages = list(languages)
        # The first request loads the recognition model (~40 s cold). Pay it at startup.
        self.read(np.full((32, 128, 3), 255, np.uint8))

    def read(self, image) -> list[TextLine]:
        from PIL import Image

        h, w = image.shape[:2]
        buf = io.BytesIO()
        Image.fromarray(image).save(buf, format="PNG")
        png = buf.getvalue()
        data = self._nsdata.dataWithBytes_length_(png, len(png))
        source = self._quartz.CGImageSourceCreateWithData(data, None)
        cg = self._quartz.CGImageSourceCreateImageAtIndex(source, 0, None)
        req = self._vision.VNRecognizeTextRequest.alloc().init()
        req.setRecognitionLevel_(self._vision.VNRequestTextRecognitionLevelAccurate)
        req.setUsesLanguageCorrection_(False)  # it would "correct" EA, PES, PA into words
        req.setRecognitionLanguages_(self.languages)
        handler = self._vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, None)
        ok, err = handler.performRequests_error_([req], None)
        if not ok:
            raise RuntimeError(f"Vision text request failed: {err}")
        lines = []
        for obs in req.results() or []:
            candidates = obs.topCandidates_(1)
            if not candidates:
                continue
            c, bb = candidates[0], obs.boundingBox()
            lines.append(
                TextLine(
                    str(c.string()),
                    float(c.confidence()),
                    vision_box_to_pixels(
                        bb.origin.x, bb.origin.y, bb.size.width, bb.size.height, w, h
                    ),
                )
            )
        return lines
