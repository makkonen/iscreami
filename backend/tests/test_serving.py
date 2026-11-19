"""Tests for serving methods, including custom ones."""

from __future__ import annotations

from api.services.serving import ServingTarget, custom_serving_id, serving_method


class TestCustomServing:
    def test_parses_temperature_and_texture(self):
        m = serving_method("custom:-12.5:scoop")
        assert m is not None
        assert m.target == ServingTarget(-12.5, 70.0, 78.0)
        assert m.id == "custom:-12.5:scoop"
        assert m.group == "Custom"

    def test_id_round_trips(self):
        assert serving_method(custom_serving_id(-16.0, "firm")).target == ServingTarget(
            -16.0, 83.0, 90.0
        )

    def test_rejects_bad_ids(self):
        for bad in (
            "custom:",
            "custom:abc:scoop",
            "custom:-12:mushy",
            "custom:5:soft",
            "custom:-50:soft",
            "custom:-12:scoop:extra",
        ):
            assert serving_method(bad) is None, bad

    def test_presets_unchanged(self):
        assert serving_method("tempered").target == ServingTarget(-14.0, 70.0, 78.0)
        assert serving_method("scoop_later").id == "freezer"
