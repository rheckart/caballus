"""Re-checks the two things the review pass flagged, after a rebuild."""

import glob
import json
import os
import re

os.chdir(os.path.dirname(os.path.abspath(__file__)))

canvas = json.load(open("canvas.json", encoding="utf-8"))
heights = {a["file"]: a["h"] for a in canvas["artboards"]}

mismatches = []
for name in sorted(glob.glob("*.dc.html")):
    source = open(name, encoding="utf-8").read()
    found = re.search(r"min-height: (\d+)px", source) or re.search(
        r"height: (\d+)px; display: flex; background", source
    )
    if found and int(found.group(1)) > heights[name]:
        mismatches.append((name, found.group(1), heights[name]))
print("frame mismatches:", mismatches or "none")

PHONE = [
    "Main", "Login", "Shifts", "ShiftWork", "Horses", "HorseProfile",
    "Supplies", "Contacts", "Attendance", "Escalations", "Me",
]
print("controls under 44px on a phone artboard:")
short = 0
for stem in PHONE:
    source = open(stem + ".dc.html", encoding="utf-8").read()
    hits = re.findall(r"height: (\d+)px; padding: 0 18px; border-radius: 12px", source)
    hits += re.findall(r"height: (\d+)px; border-radius: 10px; font-size: 14px", source)
    under = [h for h in hits if int(h) < 44]
    if under:
        short += len(under)
        print(" ", stem, under)
print("  total:", short)

legacy = [
    hexv
    for hexv in ("#1e262d", "#6d7c86", "#f7c8b7")
    if any(hexv in open(g, encoding="utf-8").read() for g in glob.glob("*.dc.html"))
]
print("un-tokenised hexes still literal in output:", legacy or "none (now named tokens)")
