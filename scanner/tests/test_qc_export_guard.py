"""No network: every transport is an explicitly named test double."""

from dataclasses import replace

import pytest

from training.qc.export_guard import (
    ExportManifest,
    ExportRefused,
    RightsEntry,
    RightsRegistry,
    StagedFile,
    guarded_export,
    validate_export,
)


class FakeTransportDouble:
    def __init__(self):
        self.calls = []

    def __call__(self, staged):
        self.calls.append(staged)
        return staged


def export_double():
    return ExportManifest(
        "local:destination-double",
        "research",
        "notice-license-double",
        (StagedFile("image-double", "a" * 64, "source-double", ("notice-double",)),),
    )


def rights_double(**changes):
    entry = RightsEntry(
        "source-double",
        "notice-license-double",
        ("research",),
        ("local:destination-double",),
        True,
        ("notice-double",),
    )
    return RightsRegistry((replace(entry, **changes),))


@pytest.mark.parametrize(
    "changes",
    [
        {"license": None},
        {"license": "unknown"},
        {"license": "not yet collected"},
        {"redistribution_permitted": False},
        {"permitted_purposes": ()},
        {"permitted_destinations": ()},
        {"consent_withdrawn": True},
    ],
)
def test_unknown_or_incompatible_rights_make_zero_transport_calls(changes):
    transport = FakeTransportDouble()
    with pytest.raises(ExportRefused):
        guarded_export(export_double(), rights_double(**changes), transport)
    assert transport.calls == []


def test_unregistered_source_makes_zero_transport_calls():
    transport = FakeTransportDouble()
    with pytest.raises(ExportRefused):
        guarded_export(export_double(), RightsRegistry(()), transport)
    assert not transport.calls


def test_notices_preserved_in_the_exact_manifest_received_by_transport():
    transport = FakeTransportDouble()
    staged = export_double()
    assert guarded_export(staged, rights_double(), transport) is staged
    assert transport.calls[0].files[0].notices == ("notice-double",)
    eligibility = validate_export(staged, rights_double())
    assert eligibility.inventory == (("image-double", "a" * 64, "source-double"),)


def test_missing_notice_blocks_before_transport():
    staged = replace(export_double(), files=(replace(export_double().files[0], notices=()),))
    transport = FakeTransportDouble()
    with pytest.raises(ExportRefused):
        guarded_export(staged, rights_double(), transport)
    assert not transport.calls


def test_blanket_cc0_cannot_relicense_a_mixed_export():
    staged = replace(export_double(), declared_license="CC0-1.0")
    assert "BLANKET_LICENSE_MISMATCH" in validate_export(staged, rights_double()).reasons


def test_duplicate_registry_entries_fail_closed_instead_of_first_entry_wins():
    entry = rights_double().entries[0]
    registry = RightsRegistry((entry, replace(entry, redistribution_permitted=False)))
    assert not validate_export(export_double(), registry).allowed


def test_private_flag_does_not_grant_rights():
    assert not validate_export(export_double(), RightsRegistry(())).allowed


@pytest.mark.parametrize(
    "changes",
    [
        {"expires_at": "2026-01-02T00:00:00Z"},
        {"valid_from": "2026-01-03T00:00:00Z"},
        {"expires_at": "garbled"},
    ],
)
def test_expired_not_yet_valid_or_invalid_time_rights_make_zero_calls(changes):
    transport = FakeTransportDouble()
    rights = replace(rights_double(**changes), evaluated_at="2026-01-02T00:00:00Z")
    with pytest.raises(ExportRefused):
        guarded_export(export_double(), rights, transport)
    assert not transport.calls


def test_bounded_rights_without_trusted_check_time_fail_closed():
    transport = FakeTransportDouble()
    with pytest.raises(ExportRefused):
        guarded_export(export_double(), rights_double(expires_at="2026-01-03T00:00:00Z"), transport)
    assert not transport.calls


@pytest.mark.parametrize("value", ["false", 1, None])
def test_export_permission_requires_explicit_boolean(value):
    transport = FakeTransportDouble()
    with pytest.raises(ExportRefused):
        guarded_export(export_double(), rights_double(redistribution_permitted=value), transport)
    assert not transport.calls


@pytest.mark.parametrize("path", ["", "../original", "/absolute/original"])
def test_staged_inventory_must_have_relative_paths(path):
    staged = replace(export_double(), files=(replace(export_double().files[0], path=path),))
    assert not validate_export(staged, rights_double()).allowed
