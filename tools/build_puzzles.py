#!/usr/bin/env python3
"""Extrait une sélection de puzzles de la base ouverte Lichess (domaine public, CC0).

Télécharge https://database.lichess.org/lichess_db_puzzle.csv.zst en streaming,
garde les puzzles populaires dans une tranche de classement, en prend au plus
--per-theme par thème, et écrit data/puzzles-lichess.json.

Usage : python tools/build_puzzles.py --min 400 --max 1300 --per-theme 250
        (ou --source fichier.csv.zst pour utiliser un fichier déjà téléchargé)
"""
import argparse, csv, io, json, random, sys, urllib.request
import zstandard

URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst"
THEMES = [
    "mateIn1", "mateIn2", "mateIn3", "backRankMate", "smotheredMate", "hangingPiece",
    "fork", "pin", "skewer", "discoveredAttack", "doubleCheck", "deflection",
    "attraction", "trappedPiece", "defensiveMove", "capturingDefender",
]
COLS = ["PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation", "Popularity",
        "NbPlays", "Themes", "GameUrl", "OpeningTags"]


def rows(stream):
    reader = zstandard.ZstdDecompressor().stream_reader(stream)
    text = io.TextIOWrapper(reader, encoding="utf-8", newline="")
    for row in csv.reader(text):
        if not row or row[0] == "PuzzleId":
            continue
        yield dict(zip(COLS, row))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=int, default=400)
    ap.add_argument("--max", type=int, default=1300)
    ap.add_argument("--per-theme", type=int, default=250)
    ap.add_argument("--min-popularity", type=int, default=80)
    ap.add_argument("--min-plays", type=int, default=200)
    ap.add_argument("--source", default=None)
    ap.add_argument("--out", default="data/puzzles-lichess.json")
    a = ap.parse_args()

    random.seed(42)
    seen = {t: 0 for t in THEMES}
    picked = {t: [] for t in THEMES}  # échantillonnage par réservoir
    total = kept = 0
    src = open(a.source, "rb") if a.source else urllib.request.urlopen(
        urllib.request.Request(URL, headers={"User-Agent": "manuel-echecs (GitHub Action)"}))
    with src:
        for r in rows(src):
            total += 1
            if total % 500000 == 0:
                print(f"{total} puzzles lus, {kept} candidats", file=sys.stderr)
            try:
                rating, rd = int(r["Rating"]), int(r["RatingDeviation"])
                pop, plays = int(r["Popularity"]), int(r["NbPlays"])
            except (ValueError, KeyError):
                continue
            if not (a.min <= rating <= a.max) or rd > 100 or pop < a.min_popularity or plays < a.min_plays:
                continue
            themes = r["Themes"].split()
            hit = [t for t in THEMES if t in themes]
            if not hit:
                continue
            kept += 1
            item = {"id": r["PuzzleId"], "fen": r["FEN"], "moves": r["Moves"].split(),
                    "rating": rating, "themes": hit}
            for t in hit:
                seen[t] += 1
                if len(picked[t]) < a.per_theme:
                    picked[t].append(item)
                else:
                    j = random.randrange(seen[t])
                    if j < a.per_theme:
                        picked[t][j] = item

    out = {}
    for t in THEMES:
        for item in picked[t]:
            out[item["id"]] = item
    result = sorted(out.values(), key=lambda x: x["rating"])
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(result, f, separators=(",", ":"))
    print(f"{total} puzzles lus ; {len(result)} gardés dans {a.out}")
    for t in THEMES:
        print(f"  {t}: {len(picked[t])}")


if __name__ == "__main__":
    main()
