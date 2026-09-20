"""The dataset adapter boundary.

Spec section 5.3. Team access to physical garments is unresolved, so the
self-collected phone set is a *swappable adapter* behind this interface rather
than an assumption baked into the training code. Evaluate catalog data and phone
data through the same harness; nothing downstream branches on which one it is.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Sample:
    """One labelled image.

    ``group_id`` is what makes grouped splits possible and is not optional.
    FabricsCompositionDataset has 12,724 images but only 44 distinct fabrics; a
    random image-level split puts the same physical swatch in train and test and
    makes every reported number fiction. Split on ``group_id``, always.
    """

    image_path: Path
    group_id: str
    fabric: str | None = None
    fibre_family: str | None = None
    treatment: str | None = None


class FabricDataset(ABC):
    """A source of labelled fabric images."""

    domain: str  # "catalog" | "phone" -- reported alongside every metric

    @abstractmethod
    def __len__(self) -> int: ...

    @abstractmethod
    def __getitem__(self, idx: int) -> Sample: ...

    def group_ids(self) -> list[str]:
        return [self[i].group_id for i in range(len(self))]
