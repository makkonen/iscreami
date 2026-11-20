"""Tests for importer identity and shared CLI driver behavior."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import typer
from sqlalchemy import select

from api.models import Ingredient
from api.schemas import IngredientCreate
from cli.importers.base import BaseImporter
from cli.importers.driver import run_import_command
from cli.importers.nzfcdb import NZFCDBImporter
from cli.importers.usda import USDAImporter


class DummyImporter(BaseImporter):
    source_name = "dummy"

    def fetch(self, source_id: str) -> dict[str, str]:
        return {"source_id": source_id, "name": f"Item {source_id}"}

    def map(self, raw: dict[str, str]) -> IngredientCreate:
        return IngredientCreate(name=raw["name"])


def test_import_one_uses_deterministic_uuid(test_db):
    importer = DummyImporter(test_db)

    item = importer.import_one("abc-123", skip_existing=False)

    assert item is not None
    expected = uuid.uuid5(importer.import_id_namespace, "dummy:abc-123")
    assert item.id == expected
    assert item.source == "dummy"
    assert item.source_id == "abc-123"


def test_import_one_skip_existing_detects_existing_source_row(test_db):
    importer = DummyImporter(test_db)

    first = importer.import_one("abc-123")
    assert first is not None
    test_db.flush()

    second = importer.import_one("abc-123")
    assert second is None


def _write_foundation_json(tmp_path, rows: list[dict]) -> Path:
    """Write a minimal USDA Foundation Foods JSON file."""
    json_file = tmp_path / "foundation.json"
    json_file.write_text(json.dumps({"FoundationFoods": rows}), encoding="utf-8")
    return json_file


def test_usda_import_one_unknown_id_raises(test_db, tmp_path):
    json_file = _write_foundation_json(tmp_path, [{"fdcId": 1, "description": "Milk"}])
    importer = USDAImporter(test_db, json_file)

    with pytest.raises(ValueError, match="999 not found"):
        importer.import_one("999", skip_existing=False)

    # Nothing was added to the session — no phantom "USDA ?" row.
    assert test_db.scalars(select(Ingredient)).all() == []


def test_nzfcdb_import_one_unknown_id_raises(test_db, tmp_path):
    data_dir = tmp_path / "nzfcdb"
    _write_name_ft(data_dir, ["F101~Whole milk"])
    importer = NZFCDBImporter(test_db, data_dir)

    with pytest.raises(ValueError, match="M999 not found"):
        importer.import_one("M999", skip_existing=False)

    # Nothing was added to the session — no phantom "NZFCDB M999" row.
    assert test_db.scalars(select(Ingredient)).all() == []


# --- Shared CLI driver (run_import_command) ---


def _fake_session(monkeypatch) -> MagicMock:
    """Patch driver.SessionLocal to return a recording mock session."""
    session = MagicMock()
    monkeypatch.setattr("cli.importers.driver.SessionLocal", lambda: session)
    return session


def test_driver_list_echoes_foods_and_does_not_commit(capsys, monkeypatch):
    session = _fake_session(monkeypatch)
    importer = MagicMock()
    importer.list_foods.return_value = [("1", "Milk"), ("2", "Cream")]

    run_import_command(
        lambda db: importer,
        target_id=None,
        all_foods=False,
        list_only=True,
        id_option="food-id",
    )

    assert capsys.readouterr().out == "1: Milk\n2: Cream\n"
    session.commit.assert_not_called()
    session.close.assert_called_once()


def test_driver_id_imports_and_commits(capsys, monkeypatch):
    session = _fake_session(monkeypatch)
    importer = MagicMock()
    importer.import_one.return_value = SimpleNamespace(name="Milk")

    run_import_command(
        lambda db: importer,
        target_id="5",
        all_foods=False,
        list_only=False,
        id_option="food-id",
    )

    importer.import_one.assert_called_once_with("5")
    assert capsys.readouterr().out == "Imported: Milk\n"
    session.commit.assert_called_once()
    session.close.assert_called_once()


def test_driver_id_skip_existing_echoes_skipped_and_commits(capsys, monkeypatch):
    session = _fake_session(monkeypatch)
    importer = MagicMock()
    importer.import_one.return_value = None

    run_import_command(
        lambda db: importer,
        target_id="5",
        all_foods=False,
        list_only=False,
        id_option="fdc-id",
    )

    assert capsys.readouterr().out == "Skipped (already exists): 5\n"
    session.commit.assert_called_once()


def test_driver_all_counts_imported_and_commits(capsys, monkeypatch):
    session = _fake_session(monkeypatch)
    importer = MagicMock()
    importer.import_all.return_value = [
        ("Milk", SimpleNamespace(name="Milk")),
        ("Already here", None),
    ]

    run_import_command(
        lambda db: importer,
        target_id=None,
        all_foods=True,
        list_only=False,
        id_option="food-id",
    )

    assert capsys.readouterr().out == "  + Milk\nImported 1 ingredients.\n"
    session.commit.assert_called_once()
    session.close.assert_called_once()


def test_driver_bare_invocation_raises_exit_and_does_not_commit(capsys, monkeypatch):
    session = _fake_session(monkeypatch)
    importer = MagicMock()

    with pytest.raises(typer.Exit) as exc:
        run_import_command(
            lambda db: importer,
            target_id=None,
            all_foods=False,
            list_only=False,
            id_option="food-id",
        )

    assert exc.value.exit_code == 1
    assert capsys.readouterr().out == "Specify --food-id, --all, or --list\n"
    session.commit.assert_not_called()
    session.close.assert_called_once()


# --- NZFCDBImporter.import_all ---


def _write_name_ft(data_dir: Path, rows: list[str]) -> None:
    """Write a minimal NAME.FT (copyright line, header row, data rows)."""
    ft_dir = data_dir / "Supporting files" / "ASCII Text Files"
    ft_dir.mkdir(parents=True, exist_ok=True)
    lines = ["Copyright (c) NZFCDB", "FoodID~Food Name", *rows]
    (ft_dir / "NAME.FT").write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_nzfcdb_import_all_excludes_non_icecream_chapters(test_db, tmp_path):
    data_dir = tmp_path / "nzfcdb"
    _write_name_ft(
        data_dir,
        [
            "F101~Whole milk",  # dairy — kept
            "M101~Beef steak",  # meat — excluded
        ],
    )
    importer = NZFCDBImporter(test_db, data_dir)

    results = list(importer.import_all())

    assert [name for name, _ in results] == ["Whole milk"]


def test_nzfcdb_import_all_skips_existing_and_persists_new(test_db, tmp_path):
    data_dir = tmp_path / "nzfcdb"
    _write_name_ft(
        data_dir,
        [
            "A101~Bread roll",
            "F101~Whole milk",
        ],
    )
    existing = Ingredient(name="Whole milk", source="nzfcdb", source_id="F101")
    test_db.add(existing)
    test_db.flush()

    importer = NZFCDBImporter(test_db, data_dir)
    results = list(importer.import_all())

    # A101 is new → yields (name, persisted Ingredient)
    name, ingredient = results[0]
    assert name == "Bread roll"
    assert ingredient is not None
    assert ingredient.source == "nzfcdb"
    assert ingredient.source_id == "A101"
    test_db.flush()
    persisted = test_db.scalar(
        select(Ingredient).where(
            Ingredient.source == "nzfcdb", Ingredient.source_id == "A101"
        )
    )
    assert persisted is not None and persisted.id == ingredient.id

    # F101 already exists → skipped, yields (name, None)
    assert results[1] == ("Whole milk", None)


def _food(fdc_id: int, name: str, category: str, **nutrients: float) -> dict:
    ids = {"water": 1051, "fat": 1004, "sugar": 2000, "lactose": 1013}
    return {
        "fdcId": fdc_id,
        "description": name,
        "foodCategory": {"description": category},
        "foodNutrients": [
            {"nutrient": {"id": ids[k]}, "amount": v} for k, v in nutrients.items()
        ],
    }


def test_usda_reads_sr_legacy_and_estimates_plain_dairy(test_db, tmp_path):
    json_file = tmp_path / "sr.json"
    rows = [
        _food(
            1,
            "Cream, fluid, heavy whipping",
            "Dairy and Egg Products",
            water=57.7,
            fat=36.1,
            sugar=2.9,
        ),
        _food(
            2,
            "Cheese, cheddar",
            "Dairy and Egg Products",
            water=37.0,
            fat=33.0,
            sugar=0.3,
        ),
        _food(
            3,
            "Milk, chocolate, fluid",
            "Dairy and Egg Products",
            water=82.0,
            fat=2.0,
            sugar=10.0,
        ),
        _food(
            4,
            "Milk, whole",
            "Dairy and Egg Products",
            water=88.1,
            fat=3.3,
            sugar=4.8,
            lactose=4.6,
        ),
    ]
    json_file.write_text(json.dumps({"SRLegacyFoods": rows}), encoding="utf-8")
    importer = USDAImporter(test_db, json_file)
    mapped = {f["description"]: importer.map(f) for f in importer._stream_foods()}

    cream = mapped["Cream, fluid, heavy whipping"]
    assert cream.milk_fat_pct == 36.1
    assert cream.msnf_pct == pytest.approx(6.2)
    assert cream.lactose_pct == 2.9  # total sugar taken as lactose
    # Cheese and flavoured milk are left as USDA gives them.
    assert mapped["Cheese, cheddar"].msnf_pct is None
    assert mapped["Milk, chocolate, fluid"].lactose_pct is None
    # A measured breakdown is kept, not overwritten.
    assert mapped["Milk, whole"].lactose_pct == 4.6


def test_usda_foundation_energy_and_sugar_fallbacks(test_db, tmp_path):
    food = {
        "fdcId": 5,
        "description": "Blueberries, raw",
        "foodCategory": {"description": "Fruits and Fruit Juices"},
        "foodNutrients": [
            {"nutrient": {"id": 2047}, "amount": 60.0},
            {"nutrient": {"id": 2048}, "amount": 57.0},
            {"nutrient": {"id": 1063}, "amount": 9.4},
        ],
    }
    mapped = USDAImporter(test_db, _write_foundation_json(tmp_path, [food])).map(food)
    assert mapped.energy_kj_per_100g == pytest.approx(57.0 * 4.184, abs=0.01)
    assert mapped.total_sugar_pct == 9.4
