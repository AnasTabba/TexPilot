"""Shop catalogues as labelled photos: the composition a product states (strict, never guessed),
the blend name a yarn buyer uses, and any fabric name in its title. No network here."""

from training.textilenet.shop_scrape import blend, composition, label


def test_the_stated_composition_is_read_and_linings_are_ignored():
    assert composition("Composition & Care 100% Cotton Machine wash up to 30C") == [
        ("cotton", 100.0)
    ]
    text = "Shell: 98% cotton, 2% elastane. Lining: 100% polyester."
    assert composition(text) == [("cotton", 98.0), ("elastane_spandex", 2.0)]
    assert composition("Printed Khaddar Shirt - 1.75 Meters") is None


def test_blends_get_the_names_yarn_is_ordered_by():
    assert blend([("cotton", 60.0), ("polyester", 40.0)]) == "CVC"
    assert blend([("polyester", 65.0), ("cotton", 35.0)]) == "PC"
    assert blend([("cotton", 98.0), ("elastane_spandex", 2.0)]) == "stretch"
    assert blend([("cotton", 100.0)]) == "pure"


def test_a_product_is_labelled_by_its_composition_and_fabric_name_or_dropped():
    p = {"title": "3 Piece Printed Lawn Suit", "product_type": "Women Fabric", "tags": [],
         "body_html": "<p>Fabric: Lawn</p><p>100% Cotton</p>"}  # fmt: skip
    got = label(p)
    assert got["fabric"] == "lawn" and got["main_fibre"] == "cotton" and got["blend"] == "pure"
    assert label({"title": "Gift card", "product_type": "", "tags": [], "body_html": ""}) is None


def test_requests_sharing_a_pace_are_spaced_even_from_parallel_threads(monkeypatch):
    import threading
    import time

    from training.textilenet import shop_scrape

    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"{}"

    times = []
    monkeypatch.setattr(
        shop_scrape.urllib.request,
        "urlopen",
        lambda *a, **k: times.append(time.monotonic()) or Resp(),
    )
    http = shop_scrape.Polite(gap=0.2)
    http.robots = {"a.example": None, "b.example": None}  # no robots.txt fetch in tests
    threads = [threading.Thread(target=http.get, args=(f"https://{h}/products.json", "catalogue"))
               for h in ("a.example", "b.example", "a.example")]  # fmt: skip
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    gaps = [b - a for a, b in zip(sorted(times), sorted(times)[1:], strict=False)]
    assert len(times) == 3 and min(gaps) >= 0.19
