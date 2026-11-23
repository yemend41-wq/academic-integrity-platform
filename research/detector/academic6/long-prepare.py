"""Seal secondary, disjoint-donor multi-window mixtures without reading predictions."""

import argparse
from collections import defaultdict, Counter
import json
from pathlib import Path
import unicodedata as ud
from prepare import (
    HERE,
    verified_inputs,
    load_candidates,
    screen,
    select,
    rank,
    normalize,
    digest,
    word_spans,
    utf16_size,
    anchors,
    hits,
    jsonlines,
    dump_lines,
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private", type=Path)
    parser.add_argument("archives", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    p = args.private
    verified_inputs(p / "inputs")
    protocol = json.loads((HERE / "long-protocol.json").read_text())
    orig = json.loads((HERE / "freeze.json").read_text())
    c = load_candidates(p / "inputs")
    blocked, hist = screen(c, json.loads(args.archives.read_text()))
    _, _, _, taken = select(c, blocked, True)
    assert hist == orig["archives"]
    earlier = {r["id"]: r for r in jsonlines(p / "all-input.jsonl")}
    assert (
        digest((p / "all-input.jsonl").read_bytes())
        == orig["inputFiles"]["all-input.jsonl"]
    )
    previous = defaultdict(set)
    known = set()
    used_people = {g for s, g in taken if s in ("za-ar", "za-en")}

    def remember(s, identity):
        n = normalize(s)
        known.add(n)
        for t in anchors(n.split()):
            previous[t].add(identity)

    for q in earlier.values():
        remember(q["text"], q["id"])

    def choose(source, fields):
        out = []
        script = "LATIN" if source == "gpa" else "ARABIC"
        ordered = sorted(
            (r for key, r in c.items() if key[0] == source),
            key=lambda r: rank(protocol["salt"], source, r["identity"]),
        )
        for row in ordered:
            if (source, row["group"]) in taken or (
                source == "za-ar" and row["group"] in used_people
            ):
                continue
            if any((source, row["identity"], k) in blocked for k in fields):
                continue
            raw = [row["texts"][k] for k in fields]
            wordlists = [word_spans(s) for s in raw]
            if any(len(z) < 64 for z in wordlists):
                continue
            if any(
                sum(any(script in ud.name(ch, "") for ch in s[a:b]) for a, b in ws[:64])
                < 0.7 * 64
                for s, ws in zip(raw, wordlists)
            ):
                continue
            if any(
                normalize(text) in known or hits(normalize(text).split(), previous)
                for text in raw
            ):
                continue
            if len(set(normalize(text) for text in raw)) != len(raw):
                continue
            for k, s in zip(fields, raw):
                remember(s, (source, row["identity"], k))
            taken.add((source, row["group"]))
            out.append(row)
            if len(out) == 32:
                break
        return out

    humans = choose("za-ar", ["human"])
    machines = choose("fanar", ["machine"])
    gpa = choose("gpa", ["human", "ai"])
    donor_sets = {"ar": list(zip(humans, machines)), "en": [(r, r) for r in gpa]}
    out = []
    parents = []
    for lang, selected in donor_sets.items():
        for i in range(len(selected) // 4):
            group = selected[4 * i : 4 * i + 4]
            ids = [(a["group"], b["group"]) for a, b in group]
            cluster = rank(protocol["salt"], lang, *[a + "/" + b for a, b in ids])[:24]
            parents.append([lang, cluster, ids])
            for qty in (1, 2, 3):
                text = ""
                blocks = []
                for j, (human, machine) in enumerate(group):
                    is_ai = (j - i) % 4 < qty
                    row = machine if is_ai else human
                    key = ("ai" if lang == "en" else "machine") if is_ai else "human"
                    raw = row["texts"][key]
                    w = word_spans(raw)
                    segment = raw[
                        w[0][0] : w[64][0] if len(w) > 64 else len(raw)
                    ].strip()
                    if text:
                        text += "\n\n"
                    start = utf16_size(text)
                    text += segment
                    blocks.append(
                        dict(start=start, end=utf16_size(text), machine=is_ai)
                    )
                assert len(word_spans(text)) == 256
                out.append(
                    dict(
                        id=rank(protocol["salt"], cluster, qty)[:24],
                        lang=lang,
                        text=text,
                        cohort="mixed",
                        source="fresh-long-" + lang,
                        cluster=cluster,
                        origin="mixed",
                        truthPercentage=qty * 25,
                        paragraphs=blocks,
                    )
                )
    out.sort(key=lambda r: r["id"])
    root = p / "long"
    root.mkdir(exist_ok=True)
    dump_lines(
        root / "truth.jsonl", [{k: v for k, v in r.items() if k != "text"} for r in out]
    )
    dump_lines(
        root / "all-input.jsonl",
        [{k: r[k] for k in ("id", "lang", "text")} for r in out],
    )
    dump_lines(root / "primary-input.jsonl", [])
    dump_lines(root / "private-parents.jsonl", parents)
    manifest = dict(
        protocolSHA256=digest((HERE / "long-protocol.json").read_bytes()),
        ancestorFreeze=orig["maskedInputs"]["sealed-all.jsonl"],
        selected=len(out),
        primary=0,
        expectedWords=256,
        expectedParagraphWords=64,
        sourceFamilyCounts=dict(Counter(r[0] for r in parents)),
        donorsRemovedFromOriginal=len(taken) - len(humans) - len(machines) - len(gpa),
        privateDonorCommitment=digest((root / "private-parents.jsonl").read_bytes()),
        newDonorsAvailable={
            "arabic-human": len(humans),
            "arabic-generated": len(machines),
            "english-paired": len(gpa),
        },
        inputFiles={
            f: digest((root / f).read_bytes())
            for f in ("all-input.jsonl", "primary-input.jsonl", "truth.jsonl")
        },
    )
    args.out.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print("secondary families", manifest["sourceFamilyCounts"], "cases", len(out))


if __name__ == "__main__":
    main()
