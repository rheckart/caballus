#!/usr/bin/env python3
"""Generates the Field Signal artboards for the Caballus redesign canvas.

One script so that twenty-eight screens share one set of tokens rather than
twenty-eight hand-copied approximations of them. Edit here, re-run, re-seed.
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------- tokens ----
BG = "#eef2f5"
CARD = "#ffffff"
INK = "#101418"
MUT = "#5b6b76"
FAINT = "#8b99a3"
HAIR = "#dce3e8"
OR = "#ff5a1f"
ORS = "#ffe4d9"
ORI = "#a8320a"
TE = "#0e7c7b"
TES = "#dbeeed"
TEI = "#0a5f5e"
GR = "#1f7a4d"
GRS = "#dcefe4"
RD = "#c8321a"
RDS = "#ffe0da"
DK = "#101418"
DKM = "#b7c2ca"
DKH = "#333e47"
DKACT = "#1e262d"
DKMUT = "#6d7c86"
ORB = "#f7c8b7"
SANS = "'Space Grotesk', system-ui, sans-serif"
MONO = "'DM Mono', ui-monospace, monospace"

HEAD = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&amp;family=DM+Mono:wght@400;500&amp;display=swap">
  <style>
    body { margin: 0; background: %s; }
    a { color: #0e7c7b; text-decoration: none; }
    a:hover { color: #0a5f5e; text-decoration: underline; }
  </style>
</helmet>
"""
TAIL = "</x-dc>\n</body>\n</html>\n"


def write(name, body, bg=BG):
    with open(os.path.join(HERE, name), "w", encoding="utf-8") as handle:
        handle.write(HEAD % bg + body + TAIL)


# ------------------------------------------------------------- fragments ----
def label(text, color=MUT, mb=10):
    return (
        f'<h3 style="margin: 0 0 {mb}px; font-family: {MONO}; font-size: 12px; '
        f"font-weight: 500; letter-spacing: 1.8px; text-transform: uppercase; "
        f'color: {color};">{text}</h3>'
    )


def mono(text, size=12, color=MUT, extra=""):
    return (
        f'<span style="font-family: {MONO}; font-size: {size}px; color: {color}; '
        f'{extra}">{text}</span>'
    )


def pill(text, bg=ORS, fg=ORI, h=22):
    return (
        f'<span style="display: inline-flex; align-items: center; height: {h}px; '
        f"padding: 0 9px; border-radius: 999px; background: {bg}; color: {fg}; "
        f"font-family: {MONO}; font-size: 11px; letter-spacing: 0.8px; "
        f'text-transform: uppercase; white-space: nowrap;">{text}</span>'
    )


def btn(text, kind="primary", h=44):
    styles = {
        "primary": f"background: {OR}; color: #ffffff; font-weight: 600;",
        "teal": f"background: {TE}; color: #ffffff; font-weight: 600;",
        "dark": f"background: {INK}; color: #ffffff; font-weight: 600;",
        "ghost": f"border: 1px solid {HAIR}; background: {CARD}; color: {INK}; font-weight: 500;",
        "ondark": f"border: 1px solid {DKH}; background: transparent; color: #ffffff; font-weight: 500;",
        "danger": f"border: 1px solid {RD}; background: {CARD}; color: {RD}; font-weight: 500;",
    }
    return (
        f'<span style="display: inline-flex; align-items: center; justify-content: center; '
        f"height: {h}px; padding: 0 18px; border-radius: 12px; font-size: 15px; "
        f'white-space: nowrap; {styles[kind]}">{text}</span>'
    )


def card(inner, pad=14, radius=14, bg=CARD, border=True, extra=""):
    b = f"border: 1px solid {HAIR};" if border else ""
    return (
        f'<div style="padding: {pad}px; border-radius: {radius}px; background: {bg}; '
        f'{b} {extra}">{inner}</div>'
    )


def stack(children, gap=8, extra=""):
    return (
        f'<div style="display: flex; flex-direction: column; gap: {gap}px; {extra}">'
        + "".join(children)
        + "</div>"
    )


def rowflex(children, gap=10, align="center", extra=""):
    return (
        f'<div style="display: flex; align-items: {align}; gap: {gap}px; {extra}">'
        + "".join(children)
        + "</div>"
    )


def field(label_text, value, w="100%", mono_value=False):
    fam = MONO if mono_value else SANS
    return (
        f'<span style="display: flex; flex-direction: column; gap: 5px; width: {w};">'
        f'<span style="font-family: {MONO}; font-size: 11px; letter-spacing: 1.2px; '
        f'text-transform: uppercase; color: {MUT};">{label_text}</span>'
        f'<span style="display: flex; align-items: center; height: 44px; padding: 0 12px; '
        f"border: 1px solid {HAIR}; border-radius: 12px; background: {CARD}; "
        f'font-family: {fam}; font-size: 15px; color: {INK};">{value}</span></span>'
    )


ICONS = {
    "home": '<path d="M3 10.5 12 3l9 7.5"></path><path d="M5 10v10h14V10"></path>',
    "shift": '<rect x="3" y="5" width="18" height="16" rx="3"></rect><path d="M3 10h18M8 3v4M16 3v4"></path>',
    "horse": '<path d="M5 20v-6l-2-3 3-6h5l2 3h4l4 4v8"></path><path d="M9 20v-4h5v4"></path>',
    "board": '<rect x="3" y="4" width="18" height="14" rx="3"></rect><path d="M3 9h18M9 9v9M15 9v9"></path>',
    "supplies": '<path d="M4 8h16v12H4z"></path><path d="M4 8l2-4h12l2 4M10 12h4"></path>',
    "phone": '<path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2Z"></path>',
    "flag": '<path d="M5 21V4h9l-1 3h7l-2 5 2 5h-9l-1-3H5"></path>',
    "user": '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
    "clock": '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    "sun": '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"></path>',
    "check": '<path d="M4 12.5 9 17.5 20 6.5"></path>',
    "alert": '<path d="M12 4 2.5 20h19L12 4Z"></path><path d="M12 10v4M12 17.2v.1"></path>',
    "camera": '<path d="M3 8h4l2-3h6l2 3h4v12H3z"></path><circle cx="12" cy="13" r="4"></circle>',
    "book": '<path d="M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3z"></path><path d="M4 4v16"></path>',
    "plus": '<path d="M12 5v14M5 12h14"></path>',
    "search": '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path>',
}


def icon(name, size=20, color=MUT, stroke=1.9):
    return (
        f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
        f'stroke="{color}" stroke-width="{stroke}" stroke-linecap="round" '
        f'stroke-linejoin="round">{ICONS[name]}</svg>'
    )


# ------------------------------------------------------------ phone shell ----
TABS = [
    ("Home", "home", "/"),
    ("Shifts", "shift", "/shifts"),
    ("Horses", "horse", "/horses"),
    ("Board", "board", "/board"),
    ("Supplies", "supplies", "/supplies"),
]


def tabbar(active):
    cells = []
    for name, ico, _ in TABS:
        on = name == active
        color = OR if on else MUT
        weight = 600 if on else 500
        cells.append(
            f'<span style="flex: 1 1 0; display: flex; flex-direction: column; '
            f'align-items: center; justify-content: center; gap: 4px; color: {color};">'
            f'{icon(ico, 21, color, 2)}<span style="font-size: 11px; font-weight: {weight};">'
            f"{name}</span></span>"
        )
    return (
        f'<div style="display: flex; align-items: stretch; height: 66px; '
        f'background: {CARD}; border-top: 1px solid {HAIR};">' + "".join(cells) + "</div>"
    )


def appbar(right_initials="RH"):
    return (
        f'<div style="display: flex; align-items: center; justify-content: space-between; '
        f"gap: 12px; height: 60px; padding: 0 16px; background: {CARD}; "
        f'border-bottom: 1px solid {HAIR};">'
        f'<span style="display: flex; align-items: center; gap: 9px;">'
        f'<span style="display: flex; align-items: center; justify-content: center; '
        f'width: 28px; height: 28px; border-radius: 8px; background: {OR};">'
        f'{icon("horse", 17, "#ffffff", 2)}</span>'
        f'<span style="font-size: 19px; font-weight: 700; letter-spacing: -0.4px;">Caballus</span>'
        f"</span>"
        f'<span style="display: flex; align-items: center; gap: 12px;">{icon("sun", 21, MUT, 1.8)}'
        f'<span style="display: flex; align-items: center; justify-content: center; '
        f"width: 34px; height: 34px; border-radius: 10px; background: {TE}; color: #ffffff; "
        f'font-size: 13px; font-weight: 600;">{right_initials}</span></span></div>'
    )


def phone(body, active, height=1400, bar=True):
    return (
        f'<div style="width: 390px; min-height: {height}px; display: flex; '
        f'flex-direction: column; background: {BG}; font-family: {SANS}; color: {INK};">'
        + (appbar() if bar else "")
        + body
        + '<div style="flex: 1 1 auto;"></div>'
        + tabbar(active)
        + "</div>"
    )


def h1(text, sub=None, pad="20px 16px 4px"):
    out = f'<div style="padding: {pad};">'
    if sub:
        out += (
            f'<p style="margin: 0 0 3px; font-family: {MONO}; font-size: 12px; '
            f'letter-spacing: 1.4px; text-transform: uppercase; color: {MUT};">{sub}</p>'
        )
    out += (
        f'<h1 style="margin: 0; font-size: 27px; font-weight: 700; '
        f'letter-spacing: -0.7px;">{text}</h1></div>'
    )
    return out


def section(title, inner, pad="24px 16px 0"):
    return f'<div style="padding: {pad};">' + label(title) + inner + "</div>"


# ------------------------------------------------------------- desk shell ----
NAV_GENERAL = [
    ("Home", "/"),
    ("Shifts", "/shifts"),
    ("Horses", "/horses"),
    ("Feed board", "/board"),
    ("Supplies", "/supplies"),
    ("Contacts", "/contacts"),
    ("Attendance", "/attendance"),
    ("Escalations", "/escalations"),
]
NAV_ADMIN = [
    ("Volunteers", "/admin/volunteers"),
    ("Horses", "/admin/horses"),
    ("Spaces", "/admin/spaces"),
    ("Products", "/admin/products"),
    ("Shift patterns", "/admin/shift-patterns"),
    ("Tasks", "/admin/tasks"),
    ("Thresholds", "/admin/thresholds"),
    ("Hours", "/admin/attendance"),
    ("Release versions", "/admin/release-versions"),
    ("Contacts", "/admin/contacts"),
    ("Read the whiteboard", "/admin/whiteboard-read"),
    ("Audit log", "/admin/audit"),
]


def nav_group(name, items, active):
    out = (
        f'<p style="margin: 16px 0 6px; padding: 0 16px; font-family: {MONO}; '
        f"font-size: 10px; font-weight: 500; letter-spacing: 1.8px; "
        f'text-transform: uppercase; color: {DKMUT};">{name}</p>'
    )
    for lbl, path in items:
        on = path == active
        bg = f"background: {DKACT};" if on else ""
        bar = f"border-left: 3px solid {OR};" if on else "border-left: 3px solid transparent;"
        color = "#ffffff" if on else DKM
        weight = 600 if on else 400
        out += (
            f'<span style="display: flex; align-items: center; height: 30px; '
            f"padding: 0 13px; {bar} {bg} color: {color}; font-size: 13px; "
            f'font-weight: {weight};">{lbl}</span>'
        )
    return out


def sidebar(active):
    return (
        f'<div style="flex: none; width: 248px; display: flex; flex-direction: column; '
        f'background: {DK}; color: #ffffff; overflow: hidden;">'
        f'<div style="display: flex; align-items: center; gap: 9px; height: 60px; '
        f'padding: 0 16px; border-bottom: 1px solid {DKH};">'
        f'<span style="display: flex; align-items: center; justify-content: center; '
        f'width: 26px; height: 26px; border-radius: 8px; background: {OR};">'
        f'{icon("horse", 16, "#ffffff", 2)}</span>'
        f'<span style="font-size: 17px; font-weight: 700; letter-spacing: -0.3px;">Caballus</span></div>'
        f'<div style="flex: 1 1 auto; padding-bottom: 8px;">'
        + nav_group("General", NAV_GENERAL, active)
        + nav_group("Admin", NAV_ADMIN, active)
        + "</div>"
        f'<div style="display: flex; align-items: center; gap: 10px; height: 58px; '
        f'padding: 0 16px; border-top: 1px solid {DKH};">'
        f'<span style="display: flex; align-items: center; justify-content: center; '
        f"width: 30px; height: 30px; border-radius: 9px; background: {TE}; "
        f'font-size: 12px; font-weight: 600;">RH</span>'
        f'<span style="display: flex; flex-direction: column;">'
        f'<span style="font-size: 13px; font-weight: 500;">Rob Heckart</span>'
        f'<span style="font-family: {MONO}; font-size: 10px; color: {DKMUT};">President</span>'
        f"</span></div></div>"
    )


def desk(active, title, actions, content, sub=None):
    head = (
        f'<div style="flex: none; display: flex; align-items: center; justify-content: '
        f"space-between; gap: 16px; height: 60px; padding: 0 28px; background: {CARD}; "
        f'border-bottom: 1px solid {HAIR};">'
        f'<span style="display: flex; flex-direction: column;">'
        f'<span style="font-size: 19px; font-weight: 700; letter-spacing: -0.4px;">{title}</span>'
        + (
            f'<span style="font-family: {MONO}; font-size: 11px; color: {MUT};">{sub}</span>'
            if sub
            else ""
        )
        + "</span>"
        + rowflex(actions, 10)
        + "</div>"
    )
    return (
        f'<div style="width: 1440px; height: 900px; display: flex; background: {BG}; '
        f'font-family: {SANS}; color: {INK}; overflow: hidden;">'
        + sidebar(active)
        + f'<div style="flex: 1 1 auto; display: flex; flex-direction: column; overflow: hidden;">'
        + head
        + f'<div style="flex: 1 1 auto; padding: 24px 28px; overflow: hidden;">{content}</div>'
        + "</div></div>"
    )


def table(cols, rows, widths=None, radius=16):
    widths = widths or ["auto"] * len(cols)
    head = "".join(
        f'<span style="flex: {"1 1 0" if w == "auto" else f"none"}; '
        f'{"" if w == "auto" else f"width: {w};"} font-family: {MONO}; font-size: 11px; '
        f"font-weight: 500; letter-spacing: 1.2px; text-transform: uppercase; "
        f'color: {MUT};">{c}</span>'
        for c, w in zip(cols, widths)
    )
    out = (
        f'<div style="border-radius: {radius}px; border: 1px solid {HAIR}; '
        f'background: {CARD}; overflow: hidden;">'
        f'<div style="display: flex; align-items: center; gap: 16px; padding: 12px 18px; '
        f'background: #f7f9fa; border-bottom: 1px solid {HAIR};">{head}</div>'
    )
    for i, r in enumerate(rows):
        last = i == len(rows) - 1
        cells = "".join(
            f'<span style="flex: {"1 1 0" if w == "auto" else "none"}; '
            f'{"" if w == "auto" else f"width: {w};"} display: flex; align-items: center; '
            f'gap: 6px; flex-wrap: wrap; font-size: 14px;">{cell}</span>'
            for cell, w in zip(r, widths)
        )
        border = "" if last else f"border-bottom: 1px solid #eef2f4;"
        out += (
            f'<div style="display: flex; align-items: center; gap: 16px; '
            f'padding: 13px 18px; {border}">{cells}</div>'
        )
    return out + "</div>"


def panel(title, inner, extra=""):
    return card(
        label(title) + inner,
        pad=18,
        radius=16,
        extra=extra,
    )


# ================================================================ screens ====

# --- 1. Home (already the direction sketch, rewritten here for consistency) --
def build_home():
    next_shift = (
        f'<div style="margin: 16px 16px 0; border-radius: 16px; background: {DK}; '
        f'color: #ffffff; overflow: hidden;">'
        f'<div style="display: flex; align-items: center; gap: 8px; padding: 14px 18px 0;">'
        + pill("Today", OR, "#ffffff", 24)
        + pill("You lead", "transparent", DKM, 24).replace(
            "background: transparent;", f"background: transparent; border: 1px solid {DKH};"
        )
        + "</div>"
        f'<div style="padding: 12px 18px 18px;">'
        f'<h2 style="margin: 0; font-size: 30px; font-weight: 700; letter-spacing: -0.8px; '
        f'color: #ffffff;">Feed AM &middot; 7:00</h2>'
        f'<p style="margin: 8px 0 0; font-size: 15px; color: {DKM};">4 rostered &middot; '
        f"3 signed in &middot; 18 checklist items</p>"
        + rowflex(
            [btn("Open the checklist", "primary", 52), btn("Sign in", "ondark", 52)],
            10,
            extra="margin-top: 16px;",
        )
        + "</div></div>"
    )

    def ann(text, who):
        return card(
            rowflex(
                [
                    f'<span style="flex: none; display: flex; align-items: center; '
                    f'justify-content: center; width: 34px; height: 34px; border-radius: 10px; '
                    f'background: {ORS};">{icon("flag", 18, OR)}</span>',
                    f'<span style="flex: 1 1 auto;">'
                    f'<span style="display: block; font-size: 15px; line-height: 1.45;">{text}</span>'
                    f'<span style="display: block; margin-top: 4px;">{mono(who)}</span></span>',
                ],
                12,
                "flex-start",
            )
        )

    def cover(when, gaps):
        return card(
            rowflex(
                [
                    f'<span style="flex: 1 1 auto;">'
                    f'<span style="display: block; font-size: 16px; font-weight: 600;">{when}</span>'
                    + rowflex(
                        [pill(g) for g in gaps],
                        6,
                        extra="margin-top: 7px; flex-wrap: wrap;",
                    )
                    + "</span>",
                    btn("Cover", "teal", 44),
                ],
                12,
            )
        )

    body = (
        h1("Morning, Rob", "Tue 02 Sep &middot; 6:42 AM")
        + next_shift
        + section(
            "Announcements",
            stack(
                [
                    ann("Gate latch on the north pasture sticks &mdash; lift, then push.",
                        "Kate Mullen &middot; until 09 Sep"),
                    ann("Farrier Thursday 9:00 &mdash; Willow and Pepper stay in.",
                        "Joy Alvarez &middot; until 05 Sep"),
                ]
            ),
            "26px 16px 0",
        )
        + section(
            "Shifts needing cover",
            stack(
                [
                    cover("Tomorrow &middot; Feed PM 16:30", ["No lead", "1 short"]),
                    cover("Thu 04 Sep &middot; Lunch 12:00", ["Unstaffed"]),
                ]
            ),
        )
        + section(
            "Your open escalations",
            card(
                f'<p style="margin: 0; font-size: 15px; line-height: 1.45;">Willow&rsquo;s left '
                f"front shoe is loose &mdash; heard it clicking on the concrete.</p>"
                f'<p style="margin: 6px 0 0; font-family: {MONO}; font-size: 12px; '
                f"letter-spacing: 0.6px; text-transform: uppercase; color: {TE};\">"
                f"Horse care &middot; opened 31 Aug</p>",
                extra=f"border-left: 4px solid {TE};",
            ),
            "24px 16px 24px",
        )
    )
    write("Main.dc.html", phone(body, "Home", 1240))


# --------------------------------------------------------------- 2. Login ---
def build_login():
    body = (
        f'<div style="display: flex; flex-direction: column; align-items: center; '
        f'padding: 76px 24px 0;">'
        f'<span style="display: flex; align-items: center; justify-content: center; '
        f'width: 56px; height: 56px; border-radius: 18px; background: {OR};">'
        f'{icon("horse", 32, "#ffffff", 2)}</span>'
        f'<h1 style="margin: 20px 0 4px; font-size: 32px; font-weight: 700; '
        f'letter-spacing: -0.9px;">Caballus</h1>'
        f'<p style="margin: 0 0 28px; font-size: 15px; color: {MUT}; text-align: center;">'
        f"Sign in with the address or number a coordinator has on file.</p>"
        + card(
            field("Email or mobile", "kate@calvertrescue.org")
            + f'<div style="margin-top: 14px;">{btn("Send me a code", "primary", 52)}</div>'
            + f'<p style="margin: 12px 0 0; font-size: 13px; line-height: 1.5; color: {MUT};">'
            f"We text or email a six-digit code. Sign-in codes are separate from "
            f"alerts, and STOP never stops them.</p>",
            pad=18,
            radius=16,
            extra="width: 100%; box-sizing: border-box;",
        )
        + f'<p style="margin: 22px 0 0; font-size: 13px; color: {MUT}; text-align: center;">'
        f"There is no public sign-up. A Volunteer Coordinator adds you.</p>"
        + rowflex(
            [
                f'<span style="font-size: 13px; color: {TE};">Privacy policy</span>',
                f'<span style="color: {HAIR};">&middot;</span>',
                f'<span style="font-size: 13px; color: {TE};">Terms</span>',
            ],
            8,
            extra="margin-top: 14px;",
        )
        + "</div>"
    )
    body = (
        f'<div style="width: 390px; min-height: 844px; display: flex; flex-direction: column; '
        f'background: {BG}; font-family: {SANS}; color: {INK};">' + body + "</div>"
    )
    write("Login.dc.html", body)


# -------------------------------------------------------------- 3. Shifts ---
def build_shifts():
    def mine(day, kind, time, role, roster, extras):
        return card(
            rowflex(
                [
                    f'<span style="flex: 1 1 auto;">'
                    f'<span style="display: block; font-size: 16px; font-weight: 600;">'
                    f"{day} &middot; {kind} {time}</span>"
                    f'<span style="display: block; margin-top: 3px; font-size: 14px; '
                    f'color: {MUT};">{roster}</span>'
                    + rowflex([pill(e[0], e[1], e[2]) for e in extras], 6,
                              extra="margin-top: 8px; flex-wrap: wrap;")
                    + "</span>",
                    pill(role, TES, TEI, 24),
                ],
                12,
                "flex-start",
            )
            + rowflex(
                [btn("Open", "dark", 44), btn("Drop", "ghost", 44), btn("Call it short", "ghost", 44)],
                8,
                extra="margin-top: 12px; flex-wrap: wrap;",
            )
        )

    def open_shift(day, kind, time, gaps):
        return card(
            rowflex(
                [
                    f'<span style="flex: 1 1 auto;">'
                    f'<span style="display: block; font-size: 16px; font-weight: 600;">'
                    f"{day} &middot; {kind} {time}</span>"
                    + rowflex([pill(g) for g in gaps], 6,
                              extra="margin-top: 7px; flex-wrap: wrap;")
                    + "</span>",
                    btn("Cover", "teal", 44),
                ],
                12,
            )
        )

    body = (
        h1("My shifts", "The next fortnight")
        + section(
            "Mine",
            stack(
                [
                    mine("Today", "Feed AM", "7:00", "Lead", "4 rostered &middot; 3 signed in",
                         [("In progress", GRS, GR)]),
                    mine("Wed 03 Sep", "Feed PM", "16:30", "Volunteer", "5 rostered", []),
                    mine("Sat 06 Sep", "Feed AM", "7:00", "Volunteer",
                         "3 rostered &middot; 1 dropped", [("Short", ORS, ORI)]),
                ],
                10,
            ),
            "22px 16px 0",
        )
        + section(
            "Open to sign-up",
            stack(
                [
                    open_shift("Tomorrow", "Feed PM", "16:30", ["No lead", "1 short"]),
                    open_shift("Thu 04 Sep", "Lunch", "12:00", ["Unstaffed"]),
                    open_shift("Sun 07 Sep", "Pop-up", "14:00", ["Hosing down &middot; heat"]),
                ],
                10,
            ),
        )
        + section(
            "Leaderless",
            card(
                f'<p style="margin: 0; font-size: 15px; line-height: 1.45;">Nobody is leading '
                f"Wednesday&rsquo;s Feed PM. You are rostered on it.</p>"
                + f'<div style="margin-top: 12px;">{btn("Take charge as acting lead", "teal", 44)}</div>',
                extra=f"border-left: 4px solid {OR};",
            ),
            "24px 16px 24px",
        )
    )
    write("Shifts.dc.html", phone(body, "Shifts", 1580))


# ------------------------------------------------- 4. Shift work surface -----
def build_shift_work():
    def item(text, done, tags=()):
        box = (
            f'<span style="flex: none; display: flex; align-items: center; justify-content: '
            f"center; width: 28px; height: 28px; border-radius: 9px; "
            + (
                f'background: {GR};">{icon("check", 16, "#ffffff", 2.6)}'
                if done
                else f'border: 2px solid {HAIR}; background: {CARD};">'
            )
            + "</span>"
        )
        deco = "text-decoration: line-through; color: %s;" % FAINT if done else ""
        return rowflex(
            [
                box,
                f'<span style="flex: 1 1 auto; font-size: 15px; line-height: 1.4; {deco}">{text}</span>'
                + ("" if not tags else ""),
            ]
            + [pill(t[0], t[1], t[2]) for t in tags],
            10,
            "center",
            extra=f"padding: 11px 0; border-bottom: 1px solid #eef2f4;",
        )

    def horse_card(name, stall, items, alerts=()):
        head = rowflex(
            [
                f'<span style="flex: 1 1 auto; font-size: 17px; font-weight: 700; '
                f'letter-spacing: -0.3px;">{name}</span>',
                mono(stall, 12, MUT),
            ],
            10,
        )
        alert_row = (
            rowflex([pill(a, RDS, RD) for a in alerts], 6, extra="margin-top: 8px; flex-wrap: wrap;")
            if alerts
            else ""
        )
        return card(head + alert_row + "".join(items), pad=16, radius=16)

    header = (
        f'<div style="padding: 18px 16px 0;">'
        + rowflex(
            [
                f'<span style="flex: 1 1 auto;">'
                f'<span style="display: block;">{mono("Tue 02 Sep &middot; 7:00", 12, MUT)}</span>'
                f'<h1 style="margin: 2px 0 0; font-size: 27px; font-weight: 700; '
                f'letter-spacing: -0.7px;">Feed AM</h1></span>',
                pill("In progress", GRS, GR, 26),
            ],
            10,
            "flex-start",
        )
        + card(
            rowflex(
                [
                    f'<span style="flex: 1 1 auto;">'
                    f'<span style="display: block; font-size: 15px; font-weight: 600;">'
                    f"12 of 18 done</span>"
                    f'<span style="display: block; height: 8px; margin-top: 8px; border-radius: '
                    f'999px; background: {HAIR}; overflow: hidden;">'
                    f'<span style="display: block; width: 66%; height: 8px; background: {GR};">'
                    f"</span></span></span>",
                    pill("2 unsent", ORS, ORI, 24),
                ],
                12,
            ),
            pad=14,
            extra="margin-top: 14px;",
        )
        + "</div>"
    )

    prep = section(
        "Prep owed to this Shift",
        card(
            f'<p style="margin: 0; font-size: 15px; line-height: 1.45;">Soak Pepper&rsquo;s beet '
            f"pulp &mdash; owed by Feed AM, not yet done.</p>"
            + f'<div style="margin-top: 10px;">{rowflex([btn("Done", "primary", 44), btn("Not done", "ghost", 44)], 8)}</div>',
            extra=f"border-left: 4px solid {OR};",
        ),
        "22px 16px 0",
    )

    horses = section(
        "Per horse",
        stack(
            [
                horse_card(
                    "Willow",
                    "Stall 2 &amp; 3",
                    [
                        item("Feed &mdash; 2 scoops senior, 1 well beet pulp", True),
                        item("Medicate &mdash; Previcox, in feed", False,
                             [("Medication", RDS, RD)]),
                        item("Turn out to North Pasture", False),
                        item("Sheet on &mdash; overnight low 38&deg;", False),
                    ],
                    alerts=("Bites &mdash; do not hand-feed",),
                ),
                horse_card(
                    "Pepper",
                    "Stall 4",
                    [
                        item("Feed &mdash; 1 scoop senior, soaked", True),
                        item("Muck the stall", True),
                        item("Fly spray", False),
                    ],
                ),
                horse_card(
                    "Juniper",
                    "Barn &mdash; no stall",
                    [
                        item("Feed &mdash; 3 flakes hay", False),
                        item("Water &mdash; heater on", False),
                    ],
                    alerts=("Allergy &mdash; no alfalfa",),
                ),
            ],
            10,
        ),
    )

    rescue = section(
        "The rescue",
        card(
            item("Sweep the barn aisle", False)
            + item("Hay in every paddock", True)
            + item("Muck the run-in", False).replace("border-bottom: 1px solid #eef2f4;", ""),
            pad=16,
            radius=16,
        ),
    )

    notes = section(
        "Shift Notes",
        stack(
            [
                card(
                    f'<p style="margin: 0; font-size: 15px; line-height: 1.45;">Juniper barely '
                    f"touched last night&rsquo;s hay. Worth watching at lunch.</p>"
                    + f'<p style="margin: 6px 0 0;">{mono("Kate Mullen &middot; 06:58")}</p>'
                ),
                card(
                    rowflex(
                        [
                            f'<span style="flex: 1 1 auto; font-size: 15px; color: {MUT};">'
                            f"Add a note for Lunch and Feed PM&hellip;</span>",
                            btn("Add", "ghost", 44),
                        ],
                        10,
                    )
                ),
            ],
            8,
        ),
    )

    close = section(
        "Closing",
        card(
            f'<p style="margin: 0 0 10px; font-size: 15px; line-height: 1.45; font-weight: 600;">'
            f"Two things are blocking close</p>"
            + stack(
                [
                    rowflex([icon("alert", 17, ORI), f'<span style="font-size: 14px;">'
                             f"Joy Alvarez is still signed in</span>"], 8),
                    rowflex([icon("alert", 17, ORI), f'<span style="font-size: 14px;">'
                             f"2 ticks still unsent on this phone</span>"], 8),
                ],
                8,
            )
            + f'<div style="margin-top: 14px;">{btn("Close the Shift", "dark", 48)}</div>',
            pad=16,
            radius=16,
            extra=f"background: {ORS}; border-color: {ORB};",
        ),
        "24px 16px 24px",
    )

    body = header + prep + horses + rescue + notes + close
    write("ShiftWork.dc.html", phone(body, "Shifts", 2240))


# -------------------------------------------------------------- 5. Horses ---
def build_horses():
    def tab(text, on):
        return (
            f'<span style="flex: 1 1 0; display: flex; align-items: center; justify-content: '
            f"center; height: 44px; border-radius: 10px; font-size: 14px; "
            + (
                f'font-weight: 600; background: {CARD}; color: {INK}; box-shadow: 0 1px 2px rgba(16,20,24,0.08);'
                if on
                else f"font-weight: 500; color: {MUT};"
            )
            + f'">{text}</span>'
        )

    def horse_row(name, stall, halter, tags=()):
        return card(
            rowflex(
                [
                    f'<span style="flex: none; width: 12px; height: 12px; border-radius: 999px; '
                    f'background: {halter}; border: 1px solid rgba(16,20,24,0.12);"></span>',
                    f'<span style="flex: 1 1 auto;">'
                    f'<span style="display: block; font-size: 16px; font-weight: 600;">{name}</span>'
                    f'<span style="display: block; margin-top: 2px;">{mono(stall)}</span>'
                    + (
                        rowflex([pill(t[0], t[1], t[2]) for t in tags], 6,
                                extra="margin-top: 7px; flex-wrap: wrap;")
                        if tags
                        else ""
                    )
                    + "</span>",
                ],
                10,
                "flex-start",
            )
        )

    body = (
        h1("Horses", "24 at the rescue")
        + f'<div style="padding: 14px 16px 0;">'
        + rowflex([tab("All horses", True), tab("Something going on", False)], 6,
                  extra=f"padding: 4px; border-radius: 12px; background: #e2e8ec;")
        + card(
            rowflex([icon("search", 18, MUT),
                     f'<span style="font-size: 15px; color: {MUT};">Search by name or stall</span>'], 10),
            pad=13,
            extra="margin-top: 12px;",
        )
        + "</div>"
        + section(
            "In stall order",
            stack(
                [
                    horse_row("Willow", "Stall 2 &amp; 3 &middot; North Pasture", "#5b6b76",
                              [("Bites", RDS, RD)]),
                    horse_row("Pepper", "Stall 4 &middot; North Pasture", "#ff5a1f"),
                    horse_row("Marigold", "Stall 5 &middot; South Pasture", "#f2c14e"),
                    horse_row("Juniper", "Small Barn &middot; no stall", "#0e7c7b",
                              [("No alfalfa", RDS, RD)]),
                    horse_row("Domino", "Stall 9 &middot; South Pasture", "#101418"),
                    horse_row("Clover", "Stall 10 &middot; Back Paddock", "#6f9b4a"),
                    horse_row("Atlas", "Stall 12", "#8b5cf6"),
                ],
                8,
            ),
            "22px 16px 0",
        )
        + section(
            "Departed",
            card(
                rowflex(
                    [
                        f'<span style="flex: 1 1 auto; font-size: 15px; color: {MUT};">'
                        f"Rosie &middot; adopted 14 Jun 2026</span>",
                        f'<span style="font-size: 14px; color: {TE};">Open</span>',
                    ],
                    10,
                )
            ),
            "24px 16px 24px",
        )
    )
    write("Horses.dc.html", phone(body, "Horses", 1620))


# ------------------------------------------------------- 6. Horse profile ---
def build_horse_profile():
    def attr(k, v):
        return (
            f'<span style="display: flex; flex-direction: column; gap: 3px; min-width: 0;">'
            f"{mono(k, 11, MUT, 'letter-spacing: 1.2px; text-transform: uppercase;')}"
            f'<span style="font-size: 15px; font-weight: 500;">{v}</span></span>'
        )

    def timeline(kind, kind_bg, kind_fg, text, when, children=()):
        inner = (
            rowflex([pill(kind, kind_bg, kind_fg), mono(when)], 8)
            + f'<p style="margin: 8px 0 0; font-size: 15px; line-height: 1.45;">{text}</p>'
        )
        for c in children:
            inner += card(
                rowflex([pill("Escalation", TES, TEI), mono(c[1])], 8)
                + f'<p style="margin: 8px 0 0; font-size: 14px; line-height: 1.45;">{c[0]}</p>',
                pad=12,
                extra=f"margin-top: 10px; background: #f7f9fa; border-left: 3px solid {TE};",
            )
        return card(inner, pad=14)

    body = (
        f'<div style="padding: 16px 16px 0;">'
        f'<span style="font-size: 14px; color: {TE};">&larr; Back to horses</span>'
        + rowflex(
            [
                f'<span style="flex: none; width: 56px; height: 56px; border-radius: 16px; '
                f'background: #d9e2e7; display: flex; align-items: center; justify-content: center;">'
                f'{icon("horse", 30, "#7d8f9b", 1.6)}</span>',
                f'<span style="flex: 1 1 auto;">'
                f'<h1 style="margin: 0; font-size: 27px; font-weight: 700; letter-spacing: -0.7px;">'
                f"Willow</h1>"
                f'<span style="display: block; margin-top: 2px;">{mono("Mare &middot; 14 &middot; at the rescue")}</span>'
                f"</span>",
            ],
            12,
            extra="margin-top: 14px;",
        )
        + "</div>"
        + section(
            "Alerts",
            stack(
                [
                    card(
                        rowflex([pill("Prohibition", RDS, RD), mono("since 12 Mar 2026")], 8)
                        + f'<p style="margin: 8px 0 0; font-size: 15px; line-height: 1.45; '
                        f'font-weight: 500;">Bites &mdash; do not hand-feed. Use a bucket.</p>',
                        extra=f"border-left: 4px solid {RD};",
                    ),
                    card(
                        rowflex([pill("Care", ORS, ORI), mono("since 02 Aug 2026")], 8)
                        + f'<p style="margin: 8px 0 0; font-size: 15px; line-height: 1.45; '
                        f'font-weight: 500;">Left front needs picking out twice a day.</p>',
                        extra=f"border-left: 4px solid {OR};",
                    ),
                ]
            ),
            "22px 16px 0",
        )
        + section(
            "Attributes",
            card(
                f'<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); '
                f'gap: 16px;">'
                + attr("Stall", "2 &amp; 3")
                + attr("Pasture", "North")
                + attr("Paddock", "Not set")
                + attr("Halter", "Grey")
                + "</div>",
                pad=16,
                radius=16,
            ),
        )
        + section(
            "Feeding",
            card(
                rowflex([mono("Current version &middot; from 18 Aug"), pill("3 lines", TES, TEI)], 8,
                        extra="justify-content: space-between;")
                + stack(
                    [
                        f'<span style="font-size: 15px;"><strong style="font-weight: 600;">Feed AM'
                        f"</strong> &mdash; 2 scoops senior, 1 well beet pulp</span>",
                        f'<span style="font-size: 15px;"><strong style="font-weight: 600;">Feed AM'
                        f"</strong> &mdash; Previcox 57mg, in feed</span>",
                        f'<span style="font-size: 15px;"><strong style="font-weight: 600;">Feed PM'
                        f"</strong> &mdash; 2 scoops senior</span>",
                    ],
                    8,
                    extra="margin-top: 12px;",
                ),
                pad=16,
                radius=16,
            ),
        )
        + section(
            "Weight and body condition",
            card(
                rowflex(
                    [
                        attr("Weight", "1,040 lb"),
                        attr("Taken", "28 Aug 2026"),
                        attr("Body condition", "5 of 9"),
                    ],
                    18,
                    extra="flex-wrap: wrap;",
                )
                + f'<div style="margin-top: 14px;">{btn("Record a measurement", "ghost", 44)}</div>',
                pad=16,
                radius=16,
            ),
        )
        + section(
            "Timeline",
            stack(
                [
                    timeline(
                        "Observation",
                        "#e6edf1",
                        MUT,
                        "Left front shoe is loose &mdash; heard it clicking on the concrete.",
                        "31 Aug &middot; Rob Heckart",
                        children=[("Farrier called, coming Thursday. &mdash; Kate Mullen",
                                   "31 Aug &middot; horse care &middot; open")],
                    ),
                    timeline("Alert raised", RDS, RD,
                             "Care alert: left front needs picking out twice a day.",
                             "02 Aug &middot; Kate Mullen"),
                    timeline("Measurement", GRS, GR, "Weight 1,040 lb, taken 28 Aug.",
                             "29 Aug &middot; Joy Alvarez"),
                    timeline("Feed schedule", TES, TEI,
                             "Version 4 published &mdash; beet pulp added to Feed AM.",
                             "18 Aug &middot; Kate Mullen"),
                ],
                10,
            ),
            "24px 16px 24px",
        )
    )
    write("HorseProfile.dc.html", phone(body, "Horses", 2280))


# ------------------------------------------------------------ 7. Supplies ---
def build_supplies():
    def supply(name, days, low):
        bg, fg, txt = (ORS, ORI, "At reorder point") if low else (GRS, GR, "Fine")
        return card(
            rowflex(
                [
                    f'<span style="flex: 1 1 auto;">'
                    f'<span style="display: block; font-size: 16px; font-weight: 600;">{name}</span>'
                    f'<span style="display: block; margin-top: 3px;">{mono(txt, 12, fg)}</span></span>',
                    f'<span style="flex: none; text-align: right;">'
                    f'<span style="display: block; font-family: {MONO}; font-size: 22px; '
                    f'font-weight: 500; color: {INK};">{days}</span>'
                    f"{mono('days left', 11, MUT)}</span>",
                ],
                12,
            ),
            extra=f"border-left: 4px solid {fg};" if low else "",
        )

    body = (
        h1("Supplies", "Counted by hand, projected by the app")
        + section(
            "Days of supply",
            stack(
                [
                    supply("Senior feed", "9.5", True),
                    supply("Timothy hay", "22", False),
                    supply("Beet pulp", "4", True),
                    supply("Fly spray", "31", False),
                    supply("Previcox 57mg", "16", False),
                ]
            ),
            "22px 16px 0",
        )
        + section(
            "Record a count",
            card(
                field("Product", "Senior feed")
                + f'<div style="margin-top: 12px;">{field("Days of supply", "9.5", mono_value=True)}</div>'
                + f'<div style="margin-top: 14px;">{btn("Record", "primary", 48)}</div>'
                + f'<p style="margin: 10px 0 0; font-size: 13px; color: {MUT}; line-height: 1.45;">'
                f"Counted on 02 Sep. Nothing here divides a sack &mdash; write what you see.</p>",
                pad=16,
                radius=16,
            ),
        )
        + section(
            "Reorders",
            stack(
                [
                    card(
                        rowflex([pill("Open", ORS, ORI), mono("opened 31 Aug &middot; 2 comments")], 8)
                        + f'<p style="margin: 8px 0 0; font-size: 15px; line-height: 1.45;">'
                        f"Beet pulp &mdash; down to four days, feed store closed Monday.</p>"
                    ),
                    card(
                        rowflex([pill("Closed", "#e6edf1", MUT), mono("closed 21 Aug")], 8)
                        + f'<p style="margin: 8px 0 0; font-size: 15px; line-height: 1.45; '
                        f'color: {MUT};">Fly spray &mdash; two cases collected.</p>'
                    ),
                ]
            ),
            "24px 16px 24px",
        )
    )
    write("Supplies.dc.html", phone(body, "Supplies", 1720))


# ------------------------------------------------------------ 8. Contacts ---
def build_contacts():
    def contact(name, number, hours, purpose):
        return card(
            rowflex(
                [
                    f'<span style="flex: none; display: flex; align-items: center; '
                    f"justify-content: center; width: 40px; height: 40px; border-radius: 12px; "
                    f'background: {TES};">{icon("phone", 19, TE)}</span>',
                    f'<span style="flex: 1 1 auto;">'
                    f'<span style="display: block; font-size: 16px; font-weight: 600;">{name}</span>'
                    f'<span style="display: block; margin-top: 2px; font-family: {MONO}; '
                    f'font-size: 15px; color: {TE};">{number}</span>'
                    f'<span style="display: block; margin-top: 4px; font-size: 14px; '
                    f'color: {MUT}; line-height: 1.4;">{purpose}</span>'
                    f'<span style="display: block; margin-top: 4px;">{mono(hours, 12, FAINT)}</span>'
                    f"</span>",
                ],
                12,
                "flex-start",
            ),
            pad=14,
        )

    body = (
        h1("Contacts", "Who to ring, and when")
        + section(
            "Posted numbers",
            stack(
                [
                    contact("Kate Mullen &mdash; Volunteer Coordinator", "(410) 555-0142",
                            "Any time", "Rosters, orientation, anything about a volunteer."),
                    contact("Dr. Reyes &mdash; Vet", "(410) 555-0188",
                            "Emergencies any time", "Colic, injury, anything that cannot wait."),
                    contact("Sam Okonjo &mdash; Farrier", "(443) 555-0119",
                            "Weekdays 8&ndash;5", "Loose or thrown shoes, hoof problems."),
                    contact("Barn line", "(410) 555-0100",
                            "6am&ndash;7pm", "Somebody is usually in the barn."),
                ]
            ),
            "22px 16px 0",
        )
        + section(
            "Standing rules",
            card(
                stack(
                    [
                        f'<span style="font-size: 15px; line-height: 1.45;">A real emergency is a '
                        f"phone call, not a text.</span>",
                        f'<span style="font-size: 15px; line-height: 1.45;">Gates stay shut and '
                        f"latched, always, even for a minute.</span>",
                        f'<span style="font-size: 15px; line-height: 1.45;">Nobody hand-feeds a '
                        f"horse they do not know.</span>",
                        f'<span style="font-size: 15px; line-height: 1.45;">Last one out checks '
                        f"water in every stall and paddock.</span>",
                    ],
                    12,
                ),
                pad=16,
                radius=16,
            ),
            "24px 16px 24px",
        )
    )
    write("Contacts.dc.html", phone(body, "Home", 1360))


# ---------------------------------------------------------- 9. Attendance ---
def build_attendance():
    body = (
        h1("Visit", "Not a Shift &mdash; you came in on your own")
        + section(
            "Signed in",
            card(
                rowflex(
                    [
                        f'<span style="flex: none; display: flex; align-items: center; '
                        f"justify-content: center; width: 40px; height: 40px; border-radius: 12px; "
                        f'background: {GRS};">{icon("clock", 20, GR)}</span>',
                        f'<span style="flex: 1 1 auto;">'
                        f'<span style="display: block; font-size: 16px; font-weight: 600;">'
                        f"9:12 AM &mdash; 2h 41m so far</span>"
                        f'<span style="display: block; margin-top: 3px; font-size: 14px; '
                        f'color: {MUT};">Mending the north pasture fence</span>'
                        f'<span style="display: block; margin-top: 5px;">'
                        f"{pill('Maintenance and grounds', TES, TEI)}</span></span>",
                    ],
                    12,
                    "flex-start",
                ),
                pad=16,
                radius=16,
            ),
            "22px 16px 0",
        )
        + section(
            "Record an Observation",
            card(
                field("About", "Willow")
                + f'<div style="margin-top: 12px;">'
                f'<span style="display: flex; flex-direction: column; gap: 5px;">'
                f"{mono('What you saw', 11, MUT, 'letter-spacing: 1.2px; text-transform: uppercase;')}"
                f'<span style="display: block; min-height: 84px; padding: 12px; '
                f"border: 1px solid {HAIR}; border-radius: 12px; background: {CARD}; "
                f'font-size: 15px; line-height: 1.45; color: {MUT};">'
                f"Fence rail on the north side is split at the post&hellip;</span></span></div>"
                + f'<div style="margin-top: 14px;">{btn("Record", "primary", 48)}</div>',
                pad=16,
                radius=16,
            ),
        )
        + section(
            "Before you sign out",
            card(
                f'<p style="margin: 0 0 12px; font-size: 15px; line-height: 1.45; '
                f'font-weight: 600;">One Observation has no decision yet</p>'
                + card(
                    f'<p style="margin: 0; font-size: 15px; line-height: 1.45;">Fence rail on the '
                    f"north side is split at the post.</p>"
                    + rowflex(
                        [btn("Escalate", "teal", 44), btn("Noted, no action", "ghost", 44)],
                        8,
                        extra="margin-top: 12px; flex-wrap: wrap;",
                    ),
                    pad=14,
                    extra="background: #ffffff;",
                ),
                pad=16,
                radius=16,
                extra=f"background: {ORS}; border-color: {ORB};",
            ),
        )
        + section(
            "Sign out",
            card(
                field("Supervising adult", "Kate Mullen")
                + f'<div style="margin-top: 12px;">{field("Their number", "(410) 555-0142", mono_value=True)}</div>'
                + rowflex(
                    [
                        f'<span style="flex: none; width: 22px; height: 22px; border-radius: 7px; '
                        f'border: 2px solid {HAIR}; background: {CARD};"></span>',
                        f'<span style="flex: 1 1 auto; font-size: 14px; line-height: 1.4;">'
                        f"They are not a parent, guardian or relative.</span>",
                    ],
                    10,
                    extra="margin-top: 14px;",
                )
                + f'<div style="margin-top: 14px;">{btn("Sign out", "dark", 48)}</div>',
                pad=16,
                radius=16,
            ),
            "24px 16px 24px",
        )
    )
    write("Attendance.dc.html", phone(body, "Home", 1780))


# -------------------------------------------------------- 10. Escalations ---
def build_escalations():
    def esc(text, scope, when, state, comments):
        bg, fg = (ORS, ORI) if state == "Open" else ("#e6edf1", MUT)
        return card(
            rowflex([pill(state, bg, fg), pill(scope, TES, TEI), mono(when)], 8,
                    extra="flex-wrap: wrap;")
            + f'<p style="margin: 9px 0 0; font-size: 15px; line-height: 1.45;">{text}</p>'
            + f'<p style="margin: 7px 0 0;">{mono(comments)}</p>',
            extra=f"border-left: 4px solid {fg};",
        )

    body = (
        h1("Escalations", "Reports that went to somebody")
        + section(
            "Open, addressed to a Scope you hold",
            stack(
                [
                    esc("Willow&rsquo;s left front shoe is loose &mdash; heard it clicking on the "
                        "concrete.", "Horse care", "31 Aug", "Open", "3 comments &middot; Rob Heckart"),
                    esc("Fence rail on the north side is split at the post.", "Maintenance",
                        "02 Sep", "Open", "No comments yet &middot; Rob Heckart"),
                ]
            ),
            "22px 16px 0",
        )
        + section(
            "Every Escalation",
            stack(
                [
                    esc("Beet pulp is down to four days.", "Supplies", "31 Aug", "Open",
                        "1 comment &middot; Joy Alvarez"),
                    esc("Water trough in the back paddock is leaking.", "Maintenance", "24 Aug",
                        "Closed", "4 comments &middot; closed by Sam Okonjo"),
                    esc("Marigold is off her feed two mornings running.", "Horse care", "19 Aug",
                        "Closed", "6 comments &middot; closed by Kate Mullen"),
                ]
            ),
            "24px 16px 24px",
        )
    )
    write("Escalations.dc.html", phone(body, "Home", 1420))


# ------------------------------------------------------------------ 11. Me ---
def build_me():
    def block(title, value, action, note=None, mono_value=False):
        inner = (
            rowflex(
                [
                    f'<span style="flex: 1 1 auto;">'
                    f"{mono(title, 11, MUT, 'letter-spacing: 1.2px; text-transform: uppercase;')}"
                    f'<span style="display: block; margin-top: 4px; font-family: '
                    f'{MONO if mono_value else SANS}; font-size: 17px; font-weight: 500;">{value}</span></span>',
                    btn(action, "ghost", 44),
                ],
                12,
            )
        )
        if note:
            inner += f'<p style="margin: 10px 0 0; font-size: 13px; line-height: 1.45; color: {MUT};">{note}</p>'
        return card(inner, pad=16, radius=16)

    body = (
        h1("Your details", "Three things you can change yourself")
        + section(
            "Account",
            stack(
                [
                    block("Name", "Rob Heckart", "Edit"),
                    block("Sign-in address", "rob@heckart.me", "Change my address",
                          "We send a code to the new address before anything moves."),
                    block("Mobile number", "(410) 555-0166", "Change my number",
                          "We text a code to the new number first.", mono_value=True),
                ],
                10,
            ),
            "22px 16px 0",
        )
        + section(
            "Texting",
            card(
                rowflex([icon("check", 18, GR, 2.4),
                         f'<span style="font-size: 15px; font-weight: 600;">'
                         f"You have agreed to be texted, and nothing is stopping it.</span>"], 10,
                        "flex-start")
                + f'<p style="margin: 10px 0 0; font-size: 14px; line-height: 1.5; color: {MUT};">'
                f"We text you when a shift you could work is short, or when there is rescue news "
                f"that will not keep. Message frequency varies. Message and data rates may apply. "
                f"Reply STOP to stop and HELP for help.</p>"
                f'<p style="margin: 10px 0 0; font-size: 14px; line-height: 1.5; color: {MUT};">'
                f"Your sign-in codes are separate, and STOP never stops those.</p>"
                + f'<div style="margin-top: 14px;">{btn("Turn my texts back on", "teal", 44)}</div>',
                pad=16,
                radius=16,
            ),
        )
        + section(
            "Session",
            card(
                rowflex(
                    [
                        f'<span style="flex: 1 1 auto; font-size: 15px; color: {MUT};">'
                        f"Signed in on this phone since 14 Aug</span>",
                        btn("Sign out", "danger", 44),
                    ],
                    10,
                ),
                pad=16,
                radius=16,
            ),
            "24px 16px 24px",
        )
    )
    write("Me.dc.html", phone(body, "Home", 1480))


# ============================================================ desk screens ===
def build_admin_volunteers():
    add = btn("Add the volunteer", "primary", 40)
    rows = [
        ["Kate Mullen", "Volunteer Coordinator, Feed Shift Lead",
         pill("Yes", GRS, GR), pill("Complete", GRS, GR), pill("Active", GRS, GR)],
        ["Joy Alvarez", "Feed Shift Lead", pill("Yes", GRS, GR),
         pill("Release stale", ORS, ORI), pill("Active", GRS, GR)],
        ["Sam Okonjo", "Head of Maintenance", pill("No", "#e6edf1", MUT),
         pill("Complete", GRS, GR), pill("Active", GRS, GR)],
        ["Priya Raman", "Feed Shift Volunteer", pill("No", "#e6edf1", MUT),
         pill("No orientation", RDS, RD), pill("Active", GRS, GR)],
        ["Danny Cho", "Feed Shift Volunteer", pill("No", "#e6edf1", MUT),
         pill("Consent needed &middot; 17", ORS, ORI), pill("Active", GRS, GR)],
        ["Marcus Webb", "Treasurer", pill("No", "#e6edf1", MUT),
         pill("Complete", GRS, GR), pill("Left 12 Jul", "#e6edf1", MUT)],
    ]
    content = rowflex(
        [
            f'<div style="flex: 1 1 auto; min-width: 0;">'
            + table(["Name", "Roles", "Medication", "Paperwork", "Status"], rows,
                    ["220px", "auto", "120px", "170px", "130px"])
            + "</div>",
            f'<div style="flex: none; width: 320px;">'
            + panel(
                "Add a volunteer",
                field("Name", "Ella Fitzgerald")
                + f'<div style="margin-top: 12px;">{field("Email", "ella@example.org")}</div>'
                + f'<div style="margin-top: 12px;">{field("Mobile", "(410) 555-0177", mono_value=True)}</div>'
                + f'<div style="margin-top: 12px;">{field("Date of birth", "Not known", mono_value=True)}</div>'
                + rowflex(
                    [
                        f'<span style="flex: none; width: 20px; height: 20px; border-radius: 6px; '
                        f'background: {OR}; display: flex; align-items: center; justify-content: center;">'
                        f'{icon("check", 13, "#ffffff", 3)}</span>',
                        f'<span style="flex: 1 1 auto; font-size: 13px; line-height: 1.4;">'
                        f"They agreed to be texted about shifts and rescue news.</span>",
                    ],
                    10,
                    extra="margin-top: 14px;",
                )
                + f'<div style="margin-top: 14px;">{btn("Add the volunteer", "primary", 42)}</div>',
            )
            + "</div>",
        ],
        20,
        "flex-start",
    )
    write("AdminVolunteers.dc.html",
          desk("/admin/volunteers", "Volunteers", [btn("Grant a role", "ghost", 40), add],
               content, "Everyone at the rescue &mdash; 24 people"))


def build_admin_horses():
    rows = [
        ["Willow", "Grey", "2 &amp; 3", "North Pasture", pill("2 alerts", RDS, RD), "3 lines"],
        ["Pepper", "Orange", "4", "North Pasture", pill("None", "#e6edf1", MUT), "2 lines"],
        ["Marigold", "Yellow", "5", "South Pasture", pill("None", "#e6edf1", MUT), "2 lines"],
        ["Juniper", "Teal", "&mdash;", "Small Barn", pill("1 alert", RDS, RD), "1 line"],
        ["Domino", "Black", "9", "South Pasture", pill("None", "#e6edf1", MUT), "2 lines"],
        ["Clover", "Green", "10", "Back Paddock", pill("None", "#e6edf1", MUT), "3 lines"],
    ]
    content = rowflex(
        [
            f'<div style="flex: 1 1 auto; min-width: 0;">'
            + table(["Name", "Halter", "Stall", "Pasture", "Alerts", "Feeding"], rows,
                    ["190px", "110px", "110px", "180px", "150px", "auto"])
            + "</div>",
            f'<div style="flex: none; width: 320px;">'
            + panel(
                "Raise an alert",
                field("Horse", "Willow")
                + f'<div style="margin-top: 12px;">{field("Kind", "Prohibition")}</div>'
                + f'<div style="margin-top: 12px;">{field("Text", "Bites &mdash; do not hand-feed")}</div>'
                + f'<div style="margin-top: 14px;">{btn("Raise the alert", "primary", 42)}</div>',
            )
            + f'<div style="margin-top: 16px;">'
            + panel(
                "Change the feed",
                f'<p style="margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: {MUT};">'
                f"Publishing writes a new version. The old one stays readable.</p>"
                + field("Horse", "Willow")
                + f'<div style="margin-top: 14px;">{btn("Publish a new version", "teal", 42)}</div>',
            )
            + "</div></div>",
        ],
        20,
        "flex-start",
    )
    write("AdminHorses.dc.html",
          desk("/admin/horses", "Horses", [btn("Add the horse", "primary", 40)], content,
               "Every horse &mdash; 24 at the rescue, 3 departed"))


def build_admin_spaces():
    rows = [
        ["Stall 1", pill("Stall", TES, TEI), "Nobody", pill("Active", GRS, GR)],
        ["Stall 2 &amp; 3", pill("Stall", TES, TEI), "Willow", pill("Active", GRS, GR)],
        ["Stall 4", pill("Stall", TES, TEI), "Pepper", pill("Active", GRS, GR)],
        ["North Pasture", pill("Pasture", GRS, GR), "Willow, Pepper", pill("Active", GRS, GR)],
        ["Back Paddock", pill("Paddock", GRS, GR), "Clover", pill("Active", GRS, GR)],
        ["Small Barn", pill("Barn", "#e6edf1", MUT), "Juniper", pill("Active", GRS, GR)],
        ["Stall 7", pill("Stall", TES, TEI), "Nobody", pill("Retired", "#e6edf1", MUT)],
    ]
    content = rowflex(
        [
            f'<div style="flex: 1 1 auto; min-width: 0;">'
            + table(["Name", "Kind", "Occupied by", "Status"], rows,
                    ["260px", "160px", "auto", "140px"])
            + "</div>",
            f'<div style="flex: none; width: 320px;">'
            + panel(
                "Add several",
                f'<p style="margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: {MUT};">'
                f"Stalls are numbered, pastures and paddocks are lettered.</p>"
                + field("Kind", "Stall")
                + f'<div style="margin-top: 12px;">{field("From", "11", mono_value=True)}</div>'
                + f'<div style="margin-top: 12px;">{field("To", "16", mono_value=True)}</div>'
                + f'<p style="margin: 12px 0 0; font-size: 13px; color: {MUT};">'
                f"Will add Stall 11 &ndash; Stall 16. Names already on file are skipped.</p>"
                + f'<div style="margin-top: 14px;">{btn("Add several", "primary", 42)}</div>',
            )
            + "</div>",
        ],
        20,
        "flex-start",
    )
    write("AdminSpaces.dc.html",
          desk("/admin/spaces", "Spaces", [btn("Add a Space", "primary", 40)], content,
               "Every Space &mdash; stalls, pastures, paddocks and barns"))


def build_admin_products():
    catalogue = [
        ["Senior feed", pill("Feed", GRS, GR), "&mdash;", "10 days", "Tri-County Feed", "9 horses"],
        ["Timothy hay", pill("Feed", GRS, GR), "&mdash;", "14 days", "Bowen Hay", "24 horses"],
        ["Beet pulp", pill("Feed", GRS, GR), "&mdash;", "7 days", "Tri-County Feed", "4 horses"],
        ["Previcox 57mg", pill("Medication", RDS, RD), "Yes", "14 days", "Vet supply", "2 horses"],
        ["Fly spray", pill("Topical", TES, TEI), "&mdash;", "10 days", "Not set", "&mdash;"],
        ["Zinc oxide", pill("Topical", TES, TEI), "&mdash;", "Not set",
         "Not set", pill("Retired", "#e6edf1", MUT)],
    ]
    suppliers = [
        ["Tri-County Feed", "(410) 555-0130", "Mon&ndash;Sat 7&ndash;5"],
        ["Bowen Hay", "(443) 555-0121", "By arrangement"],
    ]
    content = (
        table(["Name", "Kind", "Prescription", "Reorder point", "Supplier", "On schedules"],
              catalogue, ["210px", "150px", "130px", "150px", "190px", "auto"])
        + f'<div style="margin-top: 20px;">'
        + rowflex(
            [
                f'<div style="flex: 1 1 auto; min-width: 0;">'
                + label("Suppliers")
                + table(["Name", "Number", "Hours"], suppliers, ["260px", "200px", "auto"])
                + "</div>",
                f'<div style="flex: none; width: 320px;">'
                + panel(
                    "Retire a Product",
                    f'<p style="margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: {MUT};">'
                    f"A Product on a current Feed Schedule cannot be retired. Senior feed is on "
                    f"9 horses.</p>"
                    + field("Product", "Fly spray")
                    + f'<div style="margin-top: 14px;">{btn("Retire the Product", "danger", 42)}</div>',
                )
                + "</div>",
            ],
            20,
            "flex-start",
        )
        + "</div>"
    )
    write("AdminProducts.dc.html",
          desk("/admin/products", "Products and Suppliers",
               [btn("Add the Supplier", "ghost", 40), btn("Add a Product", "primary", 40)],
               content, "The catalogue &mdash; what goes in and on a horse"))


def build_admin_shift_patterns():
    patterns = [
        ["Feed AM", "Mon Tue Wed Thu Fri Sat Sun", "7:00", "4", "Kate Mullen (Lead) +3"],
        ["Lunch", "Mon Wed Fri", "12:00", "2", "Joy Alvarez (Lead) +1"],
        ["Feed PM", "Mon Tue Wed Thu Fri Sat Sun", "16:30", "4", "Nobody"],
    ]
    fortnight = []
    for day, kind, state in [
        ("Tue 02 Sep", "Feed AM &middot; 7:00", ("On it", GRS, GR)),
        ("Tue 02 Sep", "Feed PM &middot; 16:30", ("No lead", ORS, ORI)),
        ("Wed 03 Sep", "Feed AM &middot; 7:00", ("On it", GRS, GR)),
        ("Wed 03 Sep", "Lunch &middot; 12:00", ("Unstaffed", RDS, RD)),
        ("Thu 04 Sep", "Feed AM &middot; 7:00", ("Short", ORS, ORI)),
    ]:
        fortnight.append([day, kind, pill(state[0], state[1], state[2]), "Generated"])
    content = (
        label("The Patterns")
        + table(["Shift", "Days", "Starts", "Headcount", "Standing roster"], patterns,
                ["150px", "300px", "110px", "130px", "auto"])
        + f'<div style="margin-top: 20px;">'
        + rowflex(
            [
                f'<div style="flex: 1 1 auto; min-width: 0;">'
                + label("The fortnight")
                + table(["Day", "Shift", "Staffing", "Origin"], fortnight,
                        ["160px", "230px", "180px", "auto"])
                + "</div>",
                f'<div style="flex: none; width: 320px;">'
                + panel(
                    "Change the Pattern",
                    field("Pattern", "Feed PM")
                    + f'<div style="margin-top: 12px;">{field("Starts", "16:30", mono_value=True)}</div>'
                    + card(
                        rowflex(
                            [
                                f'<span style="flex: none; width: 20px; height: 20px; '
                                f"border-radius: 6px; background: {OR}; display: flex; "
                                f'align-items: center; justify-content: center;">'
                                f'{icon("check", 13, "#ffffff", 3)}</span>',
                                f'<span style="flex: 1 1 auto; font-size: 13px; line-height: 1.4;">'
                                f"Apply to the Shifts already standing</span>",
                            ],
                            10,
                            "flex-start",
                        ),
                        pad=12,
                        extra=f"margin-top: 12px; background: {ORS}; border-color: {ORB};",
                    )
                    + f'<div style="margin-top: 14px;">{btn("Save the Pattern", "primary", 42)}</div>',
                )
                + "</div>",
            ],
            20,
            "flex-start",
        )
        + "</div>"
    )
    write("AdminShiftPatterns.dc.html",
          desk("/admin/shift-patterns", "Shifts",
               [btn("Call a Pop-up", "ghost", 40), btn("Generate the fortnight", "primary", 40)],
               content, "Patterns, and the two weeks they fill"))


def build_admin_tasks():
    tasks = [
        ["Muck the stall", "Horse", pill("Essential", ORS, ORI), "Per shift", "&mdash;",
         "Bedding to the back, wet spots out."],
        ["Groom", "Horse", pill("Discretionary", "#e6edf1", MUT), "Per day", "&mdash;",
         "Pick out all four feet."],
        ["Fly spray", "Horse", pill("Discretionary", "#e6edf1", MUT), "Per day", "&mdash;",
         "Not near the eyes. Cloth for the face."],
        ["Water heaters on", "Space", pill("Essential", ORS, ORI), "Per shift",
         "Cold and wet", "Check every trough."],
        ["Sweep the aisle", "Rescue", pill("Essential", ORS, ORI), "Per shift", "&mdash;",
         "Last thing before you close."],
    ]
    assign = [
        ["Muck the stall", "Feed AM", pill("Feed AM", TES, TEI)],
        ["Groom", "Any", pill("Not yet decided", ORS, ORI)],
        ["Fly spray", "Lunch", pill("Lunch", TES, TEI)],
        ["Sweep the aisle", "Feed PM", pill("Deliberately none", "#e6edf1", MUT)],
    ]
    content = (
        label("The catalogue")
        + table(["Task", "Subject", "Priority", "Period", "Condition", "Instruction"], tasks,
                ["190px", "110px", "160px", "120px", "150px", "auto"])
        + f'<div style="margin-top: 20px;">'
        + rowflex(
            [
                f'<div style="flex: 1 1 auto; min-width: 0;">'
                + label("Task Assignments")
                + table(["Task", "Shift Type", "State"], assign, ["260px", "200px", "auto"])
                + "</div>",
                f'<div style="flex: none; width: 320px;">'
                + panel(
                    "Add a Task",
                    field("Name", "Pick out feet")
                    + f'<div style="margin-top: 12px;">{field("Subject", "Horse")}</div>'
                    + f'<div style="margin-top: 12px;">{field("Priority", "Essential")}</div>'
                    + rowflex(
                        [
                            f'<span style="flex: none; width: 20px; height: 20px; border-radius: 6px; '
                            f'border: 2px solid {HAIR};"></span>',
                            f'<span style="flex: 1 1 auto; font-size: 13px;">'
                            f"Needs Medication Authority</span>",
                        ],
                        10,
                        extra="margin-top: 14px;",
                    )
                    + f'<div style="margin-top: 14px;">{btn("Add the Task", "primary", 42)}</div>',
                )
                + "</div>",
            ],
            20,
            "flex-start",
        )
        + "</div>"
    )
    write("AdminTasks.dc.html",
          desk("/admin/tasks", "Tasks and Task Assignments", [btn("Add a Task", "primary", 40)],
               content, "One line of the checklist, and who normally does it"))


def build_admin_thresholds():
    numbers = rowflex(
        [
            field("Staying in, real feel at", "95&deg;", "1 1 0", True),
            field("Fly sheet weather, real feel up to", "85&deg;", "1 1 0", True),
            field("Cold and wet, under", "50&deg;", "1 1 0", True),
            field("Sheet weather, under", "45&deg;", "1 1 0", True),
            field("Blanket weather, under", "30&deg;", "1 1 0", True),
        ],
        14,
        "flex-end",
    )
    each = [
        ["Willow", pill("Its own number", TES, TEI), "40&deg;", "Open-Meteo &middot; real feel"],
        ["Pepper", pill("The rescue&rsquo;s number, deliberately", GRS, GR), "45&deg;",
         "Open-Meteo &middot; real feel"],
        ["Marigold", pill("Not yet decided", ORS, ORI), "45&deg;", "&mdash;"],
        ["Juniper", pill("Not yet decided", ORS, ORI), "45&deg;", "&mdash;"],
        ["Domino", pill("Its own number", TES, TEI), "35&deg;", "Open-Meteo &middot; real feel"],
    ]
    weather = card(
        rowflex(
            [
                f'<span style="flex: none; display: flex; align-items: center; justify-content: '
                f'center; width: 42px; height: 42px; border-radius: 12px; background: {TES};">'
                f'{icon("sun", 22, TE)}</span>',
                f'<span style="flex: 1 1 auto;">'
                f'<span style="display: block; font-size: 17px; font-weight: 600;">'
                f"Low 38&deg; &middot; real feel 34&deg; &middot; high 61&deg;</span>"
                f'<span style="display: block; margin-top: 3px;">'
                f"{mono('Open-Meteo, read 02 Sep 05:40')}</span></span>",
                pill("Sheet weather holds", TES, TEI, 26),
                pill("Heat rule unresolved", ORS, ORI, 26),
            ],
            14,
        ),
        pad=16,
        radius=16,
    )
    content = (
        weather
        + f'<div style="margin-top: 20px;">'
        + panel("The rescue&rsquo;s numbers",
                numbers + f'<div style="margin-top: 14px;">{btn("Publish", "primary", 42)}</div>')
        + "</div>"
        + f'<div style="margin-top: 20px;">'
        + label("Each horse &mdash; 2 decisions owed")
        + table(["Horse", "Sheet weather", "Number used", "Calibrated against"], each,
                ["200px", "330px", "180px", "auto"])
        + "</div>"
    )
    write("AdminThresholds.dc.html",
          desk("/admin/thresholds", "Thresholds", [btn("Publish", "primary", 40)], content,
               "A number is a version, and an undecided horse is not a decided one"))


def build_admin_hours():
    calvert = [
        ["Priya Raman", "02 Sep 2026", "Mucking and turnout", "3.5", "Kate Mullen"],
        ["Danny Cho", "31 Aug 2026", "Feed AM, grooming", "4.0", "Joy Alvarez"],
        ["Danny Cho", "24 Aug 2026", "Fence repair, north pasture", "8.0", "Sam Okonjo"],
        ["Priya Raman", "17 Aug 2026", "Feed PM", "2.5", "Kate Mullen"],
    ]
    aa = [
        ["Ella Fitzgerald", "12 Aug, 19 Aug, 26 Aug, 02 Sep", "&mdash;", "14.0", "&mdash;"],
    ]
    content = (
        rowflex(
            [
                f'<span style="display: flex; align-items: center; height: 38px; padding: 0 16px; '
                f"border-radius: 10px; background: {CARD}; border: 1px solid {HAIR}; "
                f'font-size: 14px; font-weight: 600;">Calvert</span>',
                f'<span style="display: flex; align-items: center; height: 38px; padding: 0 16px; '
                f'border-radius: 10px; font-size: 14px; color: {MUT};">Anne Arundel</span>',
                f'<span style="flex: 1 1 auto;"></span>',
                mono("01 Aug 2026 &ndash; 02 Sep 2026", 13, MUT),
            ],
            10,
            extra="margin-bottom: 16px;",
        )
        + label("Calvert &mdash; one row per visit, for a signature each")
        + table(["Volunteer", "Date", "Description of service", "Hours", "Supervisor"], calvert,
                ["200px", "160px", "auto", "110px", "180px"])
        + f'<div style="margin-top: 20px;">'
        + label("Anne Arundel &mdash; dates and a total, no line items")
        + table(["Volunteer", "Dates", "Description of service", "Total hours", "Supervisor"], aa,
                ["200px", "auto", "180px", "130px", "150px"])
        + "</div>"
        + card(
            rowflex(
                [
                    f'<span style="flex: 1 1 auto; font-size: 15px;">Eight-hour cap flagged on '
                    f"one visit &mdash; nothing is truncated.</span>",
                    pill("1 flagged", ORS, ORI, 24),
                ],
                12,
            ),
            pad=14,
            extra="margin-top: 16px;",
        )
    )
    write("AdminHours.dc.html",
          desk("/admin/attendance", "Volunteer hours", [btn("Export", "ghost", 40)], content,
               "Two counties, two shapes, one ledger"))


def build_admin_releases():
    rows = [
        ["Release 2026.2", "01 Aug 2026", pill("Yes", ORS, ORI), "18 of 24 signed"],
        ["Release 2026.1", "01 Feb 2026", pill("No", "#e6edf1", MUT), "24 of 24 signed"],
        ["Release 2025.2", "01 Aug 2025", pill("Yes", ORS, ORI), "Superseded"],
    ]
    content = rowflex(
        [
            f'<div style="flex: 1 1 auto; min-width: 0;">'
            + label("Published, newest first")
            + table(["Label", "Valid from", "Obsoleted prior signatures", "Signatures"], rows,
                    ["220px", "180px", "280px", "auto"])
            + card(
                f'<p style="margin: 0; font-size: 14px; line-height: 1.5; color: {MUT};">'
                f"Publishing with <strong style=\"color: {INK};\">obsoleted</strong> set stales "
                f"every signature given before the valid-from date. Nothing is removed from a "
                f"roster &mdash; the volunteer arrives flagged.</p>",
                pad=16,
                radius=16,
                extra="margin-top: 16px;",
            )
            + "</div>",
            f'<div style="flex: none; width: 320px;">'
            + panel(
                "Publish a version",
                field("Label", "Release 2026.3")
                + f'<div style="margin-top: 12px;">{field("Valid from", "01 Feb 2027", mono_value=True)}</div>'
                + rowflex(
                    [
                        f'<span style="flex: none; width: 20px; height: 20px; border-radius: 6px; '
                        f'border: 2px solid {HAIR};"></span>',
                        f'<span style="flex: 1 1 auto; font-size: 13px; line-height: 1.4;">'
                        f"Obsoletes prior signatures</span>",
                    ],
                    10,
                    extra="margin-top: 14px;",
                )
                + f'<div style="margin-top: 14px;">{btn("Publish", "primary", 42)}</div>'
                + f'<p style="margin: 10px 0 0; font-size: 13px; line-height: 1.45; color: {MUT};">'
                f"The blank template is not stored yet &mdash; there is no document storage.</p>",
            )
            + "</div>",
        ],
        20,
        "flex-start",
    )
    write("AdminReleaseVersions.dc.html",
          desk("/admin/release-versions", "Release versions", [btn("Publish", "primary", 40)],
               content, "A versioned-tier change is a version, so nothing is audited here"))


def build_admin_contacts():
    numbers = [
        ["Kate Mullen &mdash; Volunteer Coordinator", "(410) 555-0142", "Any time",
         "Rosters, orientation, anything about a volunteer."],
        ["Dr. Reyes &mdash; Vet", "(410) 555-0188", "Emergencies any time",
         "Colic, injury, anything that cannot wait."],
        ["Sam Okonjo &mdash; Farrier", "(443) 555-0119", "Weekdays 8&ndash;5",
         "Loose or thrown shoes."],
        ["Barn line", "(410) 555-0100", "6am&ndash;7pm", "Somebody is usually in the barn."],
    ]
    rules = [
        ["A real emergency is a phone call, not a text."],
        ["Gates stay shut and latched, always, even for a minute."],
        ["Nobody hand-feeds a horse they do not know."],
        ["Last one out checks water in every stall and paddock."],
    ]
    content = rowflex(
        [
            f'<div style="flex: 1 1 auto; min-width: 0;">'
            + label("Posted numbers")
            + table(["Name", "Number", "Hours", "Purpose"], numbers,
                    ["280px", "170px", "180px", "auto"])
            + f'<div style="margin-top: 20px;">'
            + label("Standing rules")
            + table(["Rule"], rules, ["auto"])
            + "</div></div>",
            f'<div style="flex: none; width: 320px;">'
            + panel(
                "Add a contact",
                field("Name", "Marcus Webb &mdash; Treasurer")
                + f'<div style="margin-top: 12px;">{field("Number", "(410) 555-0155", mono_value=True)}</div>'
                + f'<div style="margin-top: 12px;">{field("Hours", "Weekdays 9&ndash;5")}</div>'
                + f'<div style="margin-top: 12px;">{field("Purpose", "Reimbursements")}</div>'
                + f'<div style="margin-top: 14px;">{btn("Add the contact", "primary", 42)}</div>',
            )
            + f'<div style="margin-top: 16px;">'
            + panel("Add a standing rule",
                    field("Rule", "Helmets in the round pen.")
                    + f'<div style="margin-top: 14px;">{btn("Add the rule", "teal", 42)}</div>')
            + "</div></div>",
        ],
        20,
        "flex-start",
    )
    write("AdminContacts.dc.html",
          desk("/admin/contacts", "Contacts",
               [btn("Add a standing rule", "ghost", 40), btn("Add a contact", "primary", 40)],
               content, "The numbers and rules everybody reads"))


def build_admin_whiteboard():
    def report(title, tone, items):
        bg, fg = tone
        return card(
            rowflex([pill(title, bg, fg, 24), mono(f"{len(items)}")], 8)
            + stack(
                [f'<span style="font-size: 14px; line-height: 1.45;">{i}</span>' for i in items],
                7,
                extra="margin-top: 10px;",
            ),
            pad=16,
            radius=16,
        )

    left = (
        panel(
            "The panel",
            field("Which panel is this?", "Feed grid &mdash; stalls and feedings")
            + card(
                f'<div style="display: flex; flex-direction: column; align-items: center; '
                f'gap: 10px; padding: 26px 0;">{icon("camera", 30, MUT, 1.6)}'
                f'<span style="font-size: 14px; color: {MUT};">whiteboard-feed-2026-09-02.jpg</span>'
                f'{mono("2.1 MB &middot; never stored")}</div>',
                pad=12,
                extra=f"margin-top: 14px; border-style: dashed; background: #f7f9fa;",
            )
            + f'<div style="margin-top: 14px;">{btn("Read the whiteboard", "primary", 42)}</div>'
            + f'<p style="margin: 10px 0 0; font-size: 13px; line-height: 1.45; color: {MUT};">'
            f"Nothing is overwritten. A name already on file is skipped and named back.</p>",
        )
    )
    right = stack(
        [
            report("Created", (GRS, GR),
                   ["Horse &mdash; Atlas, Stall 12, black halter",
                    "Horse &mdash; Sorrel, Stall 14",
                    "Feed Schedule &mdash; Atlas, 2 lines",
                    "Space &mdash; Stall 14"]),
            report("Already on file", ("#e6edf1", MUT),
                   ["Willow &mdash; skipped whole, feed lines and all",
                    "Pepper &mdash; skipped whole",
                    "Stall 2 &amp; 3"]),
            report("Left blank", (ORS, ORI),
                   ["Stall 8 &mdash; horse name illegible",
                    "Stall 15 &mdash; PM column smudged"]),
            report("Could not be placed", (ORS, ORI),
                   ["&ldquo;J-something&rdquo; in the barn column &mdash; no stall given"]),
            report("Check these", (RDS, RD),
                   ["Previcox 57mg created as a medication &mdash; no board says "
                    "whether it needs a prescription"]),
        ],
        12,
    )
    content = rowflex(
        [f'<div style="flex: none; width: 360px;">{left}</div>',
         f'<div style="flex: 1 1 auto; min-width: 0;">{label("What that panel said")}{right}</div>'],
        20,
        "flex-start",
    )
    write("AdminWhiteboardRead.dc.html",
          desk("/admin/whiteboard-read", "Read the whiteboard", [], content,
               "One deliberate act, at the desk, on wifi"))


def build_admin_audit():
    rows = [
        ["02 Sep 09:14", "Kate Mullen", "Horse &mdash; Willow", "Halter colour", "Grey", "&mdash;"],
        ["02 Sep 08:51", "Rob Heckart", "Volunteer &mdash; Danny Cho", "Roles",
         "Feed Shift Volunteer", "Completed orientation"],
        ["01 Sep 17:02", "Kate Mullen", "Alert &mdash; Willow", "Ended", "&mdash;",
         "Farrier saw her, no longer needed"],
        ["01 Sep 11:30", "Joy Alvarez", "Horse &mdash; Atlas", "Created", "Atlas",
         "Read from the whiteboard photograph"],
        ["31 Aug 16:44", "Rob Heckart", "Medication authority &mdash; Joy Alvarez", "Granted",
         "Yes", "Trained by the vet on 30 Aug"],
        ["31 Aug 09:20", "Kate Mullen", "Volunteer &mdash; Marcus Webb", "Departure",
         "12 Jul 2026", "Moved out of state"],
    ]
    content = (
        rowflex(
            [
                f'<div style="flex: none; width: 220px;">{field("Who", "Anybody")}</div>',
                f'<div style="flex: none; width: 220px;">{field("What", "Anything")}</div>',
                f'<div style="flex: none; width: 200px;">{field("Since", "01 Aug 2026", mono_value=True)}</div>',
                f'<span style="flex: 1 1 auto;"></span>',
            ],
            14,
            "flex-end",
            extra="margin-bottom: 18px;",
        )
        + label("Newest first")
        + table(["When", "Who", "What", "Field", "Became", "Reason"], rows,
                ["140px", "150px", "260px", "140px", "180px", "auto"])
        + card(
            f'<p style="margin: 0; font-size: 14px; line-height: 1.5; color: {MUT};">'
            f"Denials are not here &mdash; they are structured logs, not rows. Publishing a "
            f"Release Version is not here either: a versioned change is a version.</p>",
            pad=16,
            radius=16,
            extra="margin-top: 16px;",
        )
    )
    write("AdminAudit.dc.html",
          desk("/admin/audit", "Audit log", [btn("Export", "ghost", 40)], content,
               "Who changed what, and why they said they did"))


# ================================================== board and public pages ===
def build_board():
    def feed_cell(lines):
        if not lines:
            return (
                f'<span style="font-family: {MONO}; font-size: 15px; color: {FAINT}; '
                f'font-style: italic;">no lunch feeding</span>'
            )
        out = []
        for text, kind in lines:
            color = {"feed": INK, "supplement": TE, "medication": RD}[kind]
            weight = 600 if kind == "medication" else 500
            out.append(
                f'<span style="display: block; font-size: 16px; font-weight: {weight}; '
                f'color: {color}; line-height: 1.35;">{text}</span>'
            )
        return "".join(out)

    def brow(stall, horse, pasture, am, lunch, pm, alerts, tint=None):
        bg = f"background: {tint};" if tint else ""
        cells = [
            (f'<span style="font-family: {MONO}; font-size: 20px; font-weight: 500;">{stall}</span>', "110px"),
            (f'<span style="font-size: 21px; font-weight: 700; letter-spacing: -0.4px;">{horse}</span>', "180px"),
            (f'<span style="font-size: 16px; color: {MUT};">{pasture}</span>', "170px"),
            (feed_cell(am), "auto"),
            (feed_cell(lunch), "auto"),
            (feed_cell(pm), "auto"),
            ("".join(
                f'<span style="display: block; margin-bottom: 4px; padding: 3px 8px; '
                f"border-left: 4px solid {RD}; background: {RDS}; color: {RD}; "
                f'font-size: 14px; font-weight: 600; line-height: 1.3;">{a}</span>'
                for a in alerts
            ) or f'<span style="color: {FAINT};">&mdash;</span>', "230px"),
        ]
        inner = "".join(
            f'<span style="flex: {"1 1 0" if w == "auto" else "none"}; '
            f'{"" if w == "auto" else f"width: {w};"} padding-right: 12px;">{c}</span>'
            for c, w in cells
        )
        return (
            f'<div style="display: flex; align-items: flex-start; padding: 12px 18px; '
            f'border-bottom: 1px solid {HAIR}; {bg}">{inner}</div>'
        )

    head_cells = ["Stall", "Horse", "Pasture", "Feed AM", "Lunch", "Feed PM", "Alerts"]
    widths = ["110px", "180px", "170px", "auto", "auto", "auto", "230px"]
    header = "".join(
        f'<span style="flex: {"1 1 0" if w == "auto" else "none"}; '
        f'{"" if w == "auto" else f"width: {w};"} font-family: {MONO}; font-size: 12px; '
        f"font-weight: 500; letter-spacing: 1.6px; text-transform: uppercase; "
        f'color: {MUT};">{c}</span>'
        for c, w in zip(head_cells, widths)
    )

    body = (
        f'<div style="width: 1280px; min-height: 800px; display: flex; flex-direction: column; '
        f'background: {BG}; font-family: {SANS}; color: {INK}; padding: 20px 22px 22px; '
        f'box-sizing: border-box;">'
        + rowflex(
            [
                f'<h1 style="margin: 0; font-size: 34px; font-weight: 700; letter-spacing: -0.9px;">'
                f"Feed board</h1>",
                f'<span style="font-size: 20px; color: {MUT};">Tuesday 2 September 2026</span>',
                f'<span style="flex: 1 1 auto;"></span>',
                pill("Updated just now", GRS, GR, 28),
            ],
            16,
            "baseline",
        )
        + rowflex(
            [
                card(
                    rowflex(
                        [
                            icon("sun", 24, TE),
                            f'<span style="flex: 1 1 auto;">'
                            f'<span style="display: block; font-size: 20px; font-weight: 600;">'
                            f"Low 38&deg; &middot; real feel 34&deg; &middot; high 61&deg;</span>"
                            f'<span style="display: block; margin-top: 3px;">'
                            f"{mono('Open-Meteo, read 05:40')}</span></span>",
                            pill("Sheet weather", TES, TEI, 26),
                            pill("Heat rule unresolved", ORS, ORI, 26),
                        ],
                        12,
                    ),
                    pad=14,
                    radius=14,
                    extra="flex: 1 1 0;",
                ),
                card(
                    rowflex([icon("flag", 20, ORI),
                             f'<span style="flex: 1 1 auto; font-size: 16px; line-height: 1.4;">'
                             f"Gate latch on the north pasture sticks &mdash; lift, then push.<br>"
                             f"Farrier Thursday 9:00 &mdash; Willow and Pepper stay in.</span>"], 12,
                            "flex-start"),
                    pad=14,
                    radius=14,
                    extra=f"flex: 1 1 0; background: {ORS}; border-color: {ORB};",
                ),
            ],
            14,
            "stretch",
            extra="margin: 16px 0 16px;",
        )
        + f'<div style="border-radius: 16px; border: 1px solid {HAIR}; background: {CARD}; '
        f'overflow: hidden;">'
        f'<div style="display: flex; padding: 12px 18px; background: #f7f9fa; '
        f'border-bottom: 1px solid {HAIR};">{header}</div>'
        + brow("1", "&mdash;", "&mdash;", [], [], [], [], tint="#f7f9fa")
        + brow("2 &amp; 3", "Willow", "North Pasture",
               [("2 scoops senior", "feed"), ("Previcox 57mg", "medication")],
               [], [("2 scoops senior", "feed")],
               ["Bites &mdash; do not hand-feed", "Pick out left front twice a day"])
        + brow("4", "Pepper", "North Pasture",
               [("1 scoop senior, soaked", "feed")], [("Handful of hay", "feed")],
               [("1 scoop senior", "feed")], [])
        + brow("5", "Marigold", "South Pasture",
               [("2 flakes hay", "feed"), ("MSM joint", "supplement")], [],
               [("2 flakes hay", "feed")], [])
        + brow("9", "Domino", "South Pasture",
               [("3 flakes hay", "feed")], [], [("3 flakes hay", "feed")], [])
        + brow("10", "Clover", "Back Paddock",
               [("2 scoops senior", "feed")], [], [("2 scoops senior", "feed")], [])
        + f'<div style="padding: 12px 18px; background: #eef2f5; border-bottom: 1px solid {HAIR};">'
        f'<span style="font-family: {MONO}; font-size: 13px; font-weight: 500; '
        f'letter-spacing: 1.6px; text-transform: uppercase; color: {MUT};">Small Barn '
        f"&mdash; no stall</span></div>"
        + brow("&mdash;", "Juniper", "&mdash;",
               [("3 flakes hay", "feed")], [], [("3 flakes hay", "feed")],
               ["Allergy &mdash; no alfalfa"])
        + "</div></div>"
    )
    write("Board.dc.html", body)


def public_shell(inner, width=900, height=1400):
    return (
        f'<div style="width: {width}px; min-height: {height}px; background: {CARD}; '
        f'font-family: {SANS}; color: {INK};">' + inner + "</div>"
    )


def public_footer():
    return (
        f'<div style="display: flex; gap: 18px; padding: 26px 56px 40px; border-top: 1px solid {HAIR}; '
        f'font-size: 14px; color: {TE};">'
        f"<span>Privacy policy</span><span>Terms and conditions</span><span>Sign in</span>"
        f'<span style="flex: 1 1 auto;"></span>'
        f'<span style="color: {MUT};">Rob Heckart, sole proprietor &middot; Maryland</span></div>'
    )


def build_landing():
    def sec(title, paras):
        return (
            f'<div style="padding: 0 56px 30px;">'
            f'<h2 style="margin: 0 0 10px; font-size: 24px; font-weight: 700; '
            f'letter-spacing: -0.5px;">{title}</h2>'
            + "".join(
                f'<p style="margin: 0 0 10px; font-size: 16px; line-height: 1.6; color: #2b3640; '
                f'max-width: 62ch;">{p}</p>'
                for p in paras
            )
            + "</div>"
        )

    hero = (
        f'<div style="padding: 56px 56px 52px; background: {DK}; color: #ffffff;">'
        + rowflex(
            [
                f'<span style="display: flex; align-items: center; justify-content: center; '
                f'width: 44px; height: 44px; border-radius: 14px; background: {OR};">'
                f'{icon("horse", 26, "#ffffff", 2)}</span>',
                f'<span style="font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">Caballus</span>',
            ],
            12,
        )
        + f'<h1 style="margin: 26px 0 14px; font-size: 46px; font-weight: 700; '
        f'letter-spacing: -1.4px; line-height: 1.08; max-width: 18ch; color: #ffffff;">'
        f"The barn whiteboard, on the phone in your pocket.</h1>"
        f'<p style="margin: 0 0 26px; font-size: 18px; line-height: 1.6; color: {DKM}; '
        f'max-width: 58ch;">Caballus is the shift, feeding and volunteer record for one horse '
        f"rescue in Maryland. Volunteers use it in the barn, on a phone, often outdoors and "
        f"often on bad signal.</p>"
        + rowflex([btn("Sign in", "primary", 52), btn("Privacy policy", "ondark", 52)], 12)
        + "</div>"
    )

    body = (
        hero
        + f'<div style="height: 34px;"></div>'
        + sec("What it is",
              ["A private application for the volunteers of one rescue. It holds the feeding "
               "board, the shift roster, the horse records and the reports volunteers file "
               "during a shift.",
               "It is not a marketplace, a social network or a public directory. Nobody outside "
               "the rescue has an account."])
        + sec("You cannot sign yourself up",
              ["There is no public sign-up form and no self-service registration. A Volunteer "
               "Coordinator creates your record from your name and your email address, and you "
               "claim it by signing in with a code we send you.",
               "If you volunteer at the rescue and cannot sign in, speak to the Volunteer "
               "Coordinator."])
        + sec("What we send by text",
              ["Two things, and only these two. When a shift you could work is short of people, "
               "and when there is rescue news that will not keep &mdash; a gate left open, a "
               "vet visit moved.",
               "Message frequency varies and is low. Message and data rates may apply. Your "
               "sign-in codes are separate, and stopping the alerts never stops those."])
        + sec("How to stop",
              ["Reply <strong>STOP</strong> to any message and the alerts stop. Reply "
               "<strong>HELP</strong> for help. You can also remove your number from your own "
               "details screen inside the app.",
               "Stopping the alerts does not stop your sign-in codes, and it does not remove you "
               "from the rescue."])
        + sec("Getting in touch",
              ["Rob Heckart, sole proprietor, Maryland. For anything about your own record, "
               "speak to the Volunteer Coordinator at the rescue."])
        + public_footer()
    )
    write("Landing.dc.html", public_shell(body, 900, 1560), bg=CARD)


def build_policy_page(name, title, sections, height):
    head = (
        f'<div style="padding: 44px 56px 24px; border-bottom: 1px solid {HAIR};">'
        + rowflex(
            [
                f'<span style="display: flex; align-items: center; justify-content: center; '
                f'width: 34px; height: 34px; border-radius: 11px; background: {OR};">'
                f'{icon("horse", 20, "#ffffff", 2)}</span>',
                f'<span style="font-size: 19px; font-weight: 700; letter-spacing: -0.4px;">Caballus</span>',
            ],
            10,
        )
        + f'<h1 style="margin: 22px 0 6px; font-size: 38px; font-weight: 700; '
        f'letter-spacing: -1.1px;">{title}</h1>'
        + f'<p style="margin: 0;">{mono("Last updated 28 August 2026", 13, MUT)}</p></div>'
    )
    body = head + '<div style="padding: 30px 0 0;">'
    for st, paras in sections:
        body += (
            f'<div style="padding: 0 56px 26px;">'
            f'<h2 style="margin: 0 0 10px; font-size: 21px; font-weight: 700; '
            f'letter-spacing: -0.4px;">{st}</h2>'
            + "".join(
                f'<p style="margin: 0 0 10px; font-size: 15px; line-height: 1.65; color: #2b3640; '
                f'max-width: 68ch;">{p}</p>'
                for p in paras
            )
            + "</div>"
        )
    body += "</div>" + public_footer()
    write(name, public_shell(body, 900, height), bg=CARD)


def build_privacy():
    build_policy_page(
        "Privacy.dc.html",
        "Privacy policy",
        [
            ("Who this is about",
             ["This policy covers the volunteers of one horse rescue in Maryland who hold an "
              "account in Caballus. Nobody else has one."]),
            ("What we hold",
             ["Your name, your email address, your mobile number if you gave one, and your date "
              "of birth if a coordinator recorded it.",
              "Your record: the roles you hold, the paperwork on file for you, the shifts you "
              "were rostered on and what you did on them.",
              "An audit trail of who changed what, and why they said they did."]),
            ("Your mobile number is never shared",
             ["No mobile information will be shared with third parties or affiliates for "
              "marketing or promotional purposes. All the above categories exclude text "
              "messaging originator opt-in data and consent; this information will not be "
              "shared with any third parties."]),
            ("Who else sees it",
             ["Our hosting provider, our mail provider, Twilio for text messages, a weather "
              "service for the forecast, and Anthropic through OpenRouter when a coordinator "
              "asks the app to read a photograph of the whiteboard.",
              "Nobody buys this data and nobody advertises against it."]),
            ("How often we text, and what it costs",
             ["Message frequency varies and is low. Message and data rates may apply."]),
            ("What you can do",
             ["Change or remove your number and email from your own details screen. Stop the "
              "texts by replying STOP. Ask what we hold, or ask us to correct or delete it, "
              "by speaking to the Volunteer Coordinator."]),
            ("Under 18",
             ["A volunteer under eighteen needs a parent or guardian's consent, recorded by a "
              "coordinator. Their age is shown as a state and never as a number."]),
            ("How long it is kept",
             ["Your record is kept while you volunteer at the rescue and afterwards as part of "
              "the rescue's own history. Sessions expire after a year."]),
            ("Changes to this policy",
             ["We will change the date at the top. Rob Heckart, sole proprietor, Maryland."]),
        ],
        1620,
    )


def build_terms():
    build_policy_page(
        "Terms.dc.html",
        "Terms and conditions",
        [
            ("Who can be on it, and how you got on it",
             ["Caballus is for the volunteers of one horse rescue. A Volunteer Coordinator "
              "creates your record. There is no public sign-up."]),
            ("The message programme",
             ["The programme is called <strong>Caballus Volunteer Alerts</strong>. We text you "
              "when a shift you could work is short, and when there is rescue news that will "
              "not keep."]),
            ("Frequency, cost, help and stopping",
             ["<strong>Frequency.</strong> Message frequency varies and is low.",
              "<strong>Cost.</strong> Message and data rates may apply.",
              "<strong>Help.</strong> Reply HELP for help, or speak to the Volunteer Coordinator.",
              "<strong>Stopping.</strong> Reply STOP and the alerts stop.",
              "<strong>Starting again.</strong> Reply START, or turn the texts back on from "
              "your own details screen."]),
            ("Signing in still works",
             ["Stopping the alerts never stops your sign-in codes. Those are a separate "
              "service and STOP does not touch them."]),
            ("Delivery is not guaranteed",
             ["Carriers are not liable for delayed or undelivered messages. A real emergency "
              "is a phone call, not a text."]),
            ("Using the application",
             ["Record what actually happened. The record is what the rescue relies on, and a "
              "closed shift does not reopen."]),
            ("No warranty",
             ["Caballus is provided as it is, without warranty of any kind."]),
            ("Changes, and getting in touch",
             ["We will change the date at the top. Rob Heckart, sole proprietor, Maryland."]),
        ],
        1480,
    )


# ------------------------------------------------------- 28. component sheet ---
def build_components():
    def swatch(name, hexv, fg="#ffffff"):
        return (
            f'<span style="display: flex; flex-direction: column; width: 118px;">'
            f'<span style="height: 56px; border-radius: 12px; background: {hexv}; '
            f'border: 1px solid rgba(16,20,24,0.08);"></span>'
            f'<span style="margin-top: 6px; font-size: 13px; font-weight: 600;">{name}</span>'
            f"{mono(hexv, 11, MUT)}</span>"
        )

    def typerow(name, sample, style):
        return rowflex(
            [
                f'<span style="flex: none; width: 150px;">{mono(name, 11, MUT)}</span>',
                f'<span style="flex: 1 1 auto; {style}">{sample}</span>',
            ],
            14,
            "baseline",
            extra=f"padding: 10px 0; border-bottom: 1px solid #eef2f4;",
        )

    body = (
        f'<div style="width: 1200px; min-height: 1080px; background: {BG}; '
        f'font-family: {SANS}; color: {INK}; padding: 32px 36px; box-sizing: border-box;">'
        f'<h1 style="margin: 0 0 4px; font-size: 32px; font-weight: 700; letter-spacing: -0.9px;">'
        f"Field Signal</h1>"
        f'<p style="margin: 0 0 26px; font-size: 16px; color: {MUT};">The parts every other '
        f"artboard is built from.</p>"
        + rowflex(
            [
                f'<div style="flex: 1 1 0;">'
                + panel(
                    "Colour",
                    rowflex(
                        [
                            swatch("Ink", INK),
                            swatch("Signal", OR),
                            swatch("Teal", TE),
                            swatch("Ok", GR),
                            swatch("Danger", RD),
                            swatch("Page", BG),
                            swatch("Card", CARD),
                            swatch("Hairline", HAIR),
                            swatch("Nav active", DKACT),
                            swatch("On dark, muted", DKMUT),
                            swatch("Warn border", ORB),
                        ],
                        12,
                        "flex-start",
                        extra="flex-wrap: wrap;",
                    ),
                )
                + "</div>",
            ],
            18,
        )
        + f'<div style="margin-top: 18px;">'
        + panel(
            "Type &mdash; Space Grotesk, with DM Mono for anything countable",
            typerow("h1 / 27 / 700", "Morning, Rob", "font-size: 27px; font-weight: 700; letter-spacing: -0.7px;")
            + typerow("h2 / 20 / 700", "Shifts needing cover", "font-size: 20px; font-weight: 700; letter-spacing: -0.4px;")
            + typerow("label / mono 12", "SHIFTS NEEDING COVER",
                      f"font-family: {MONO}; font-size: 12px; letter-spacing: 1.8px; color: {MUT};")
            + typerow("body / 15", "A Shift nobody can staff is still a Shift.", "font-size: 15px; line-height: 1.45;")
            + typerow("data / mono 15", "1,040 lb &middot; 9.5 days &middot; 16:30",
                      f"font-family: {MONO}; font-size: 15px;")
            + typerow("small / 13", "Kate Mullen, until 09 Sep", f"font-size: 13px; color: {MUT};"),
        )
        + "</div>"
        + rowflex(
            [
                f'<div style="flex: 1 1 0;">'
                + panel(
                    "Buttons &mdash; 52px on the phone, 40px at the desk",
                    rowflex(
                        [btn("Primary", "primary", 52), btn("Teal", "teal", 52),
                         btn("Dark", "dark", 52), btn("Ghost", "ghost", 52),
                         btn("Danger", "danger", 52)],
                        10,
                        extra="flex-wrap: wrap;",
                    ),
                )
                + "</div>",
                f'<div style="flex: 1 1 0;">'
                + panel(
                    "Status pills",
                    rowflex(
                        [pill("Unstaffed"), pill("No lead"), pill("Short"),
                         pill("In progress", GRS, GR), pill("Closed", "#e6edf1", MUT),
                         pill("Medication", RDS, RD), pill("Horse care", TES, TEI)],
                        8,
                        extra="flex-wrap: wrap;",
                    ),
                )
                + "</div>",
            ],
            18,
            "stretch",
            extra="margin-top: 18px;",
        )
        + rowflex(
            [
                f'<div style="flex: 1 1 0;">'
                + panel("Fields", rowflex([field("Name", "Willow"),
                                           field("Days of supply", "9.5", mono_value=True)], 14))
                + "</div>",
                f'<div style="flex: 1 1 0;">'
                + panel(
                    "Icons &mdash; 24px grid, stroke 1.9, never emoji",
                    rowflex([icon(n, 24, INK) for n in
                             ["home", "shift", "horse", "board", "supplies", "phone", "flag",
                              "clock", "sun", "alert", "camera", "search"]], 14,
                            extra="flex-wrap: wrap;"),
                )
                + "</div>",
            ],
            18,
            "stretch",
            extra="margin-top: 18px;",
        )
        + panel(
            "Rules this direction keeps",
            stack(
                [
                    f'<span style="font-size: 15px; line-height: 1.5;">Orange is the one primary '
                    f"action and the one warning colour. Teal is the second action and every link.</span>",
                    f'<span style="font-size: 15px; line-height: 1.5;">Anything countable &mdash; '
                    f"a time, a weight, a count of days &mdash; is set in DM Mono.</span>",
                    f'<span style="font-size: 15px; line-height: 1.5;">On the phone a hit target '
                    f"never goes under 44px and the primary action is 52px. At the desk a "
                    f"control is 40px, because it is a mouse.</span>",
                    f'<span style="font-size: 15px; line-height: 1.5;">A gap is named in words on '
                    f"a pill, never as a bare number.</span>",
                    f'<span style="font-size: 15px; line-height: 1.5;">The Board is pinned light '
                    f"and reads across a barn; everything else follows the volunteer&rsquo;s theme.</span>",
                ],
                9,
            ),
            extra="margin-top: 18px;",
        )
        + "</div>"
    )
    write("Components.dc.html", body)


# ------------------------------------------------------------------- run ----
def main():
    build_home()
    build_login()
    build_shifts()
    build_shift_work()
    build_horses()
    build_horse_profile()
    build_supplies()
    build_contacts()
    build_attendance()
    build_escalations()
    build_me()

    build_admin_volunteers()
    build_admin_horses()
    build_admin_spaces()
    build_admin_products()
    build_admin_shift_patterns()
    build_admin_tasks()
    build_admin_thresholds()
    build_admin_hours()
    build_admin_releases()
    build_admin_contacts()
    build_admin_whiteboard()
    build_admin_audit()

    build_board()
    build_landing()
    build_privacy()
    build_terms()
    build_components()

    # ------------------------------------------------------------ canvas ----
    phone_row_1 = [
        ("Main.dc.html", "Home", 1240),
        ("Login.dc.html", "Login", 844),
        ("Shifts.dc.html", "Shifts", 1580),
        ("ShiftWork.dc.html", "Shift work surface", 2240),
        ("Horses.dc.html", "Horses", 1620),
        ("HorseProfile.dc.html", "Horse profile", 2280),
    ]
    phone_row_2 = [
        ("Supplies.dc.html", "Supplies", 1720),
        ("Contacts.dc.html", "Contacts", 1360),
        ("Attendance.dc.html", "Attendance", 1780),
        ("Escalations.dc.html", "Escalations", 1420),
        ("Me.dc.html", "Your details", 1480),
    ]
    desk_screens = [
        ("AdminVolunteers.dc.html", "Volunteers"),
        ("AdminHorses.dc.html", "Horses (desk)"),
        ("AdminSpaces.dc.html", "Spaces"),
        ("AdminProducts.dc.html", "Products and Suppliers"),
        ("AdminShiftPatterns.dc.html", "Shift patterns"),
        ("AdminTasks.dc.html", "Tasks"),
        ("AdminThresholds.dc.html", "Thresholds"),
        ("AdminHours.dc.html", "Volunteer hours"),
        ("AdminReleaseVersions.dc.html", "Release versions"),
        ("AdminContacts.dc.html", "Contacts (desk)"),
        ("AdminWhiteboardRead.dc.html", "Read the whiteboard"),
        ("AdminAudit.dc.html", "Audit log"),
    ]

    artboards = []
    for i, (f, t, h) in enumerate(phone_row_1):
        artboards.append({"file": f, "title": t, "x": i * 500, "y": 0, "w": 390, "h": h,
                          "page": "page-1"})
    for i, (f, t, h) in enumerate(phone_row_2):
        artboards.append({"file": f, "title": t, "x": i * 500, "y": 2460, "w": 390, "h": h,
                          "page": "page-1"})
    for i, (f, t) in enumerate(desk_screens):
        artboards.append({"file": f, "title": t, "x": (i % 4) * 1600, "y": (i // 4) * 1080,
                          "w": 1440, "h": 900, "page": "page-2"})
    artboards.append({"file": "Board.dc.html", "title": "Feed board (tablet)",
                      "x": 0, "y": 0, "w": 1280, "h": 800, "page": "page-3"})
    artboards.append({"file": "Landing.dc.html", "title": "Landing (signed out)",
                      "x": 1420, "y": 0, "w": 900, "h": 1560, "page": "page-3"})
    artboards.append({"file": "Privacy.dc.html", "title": "Privacy policy",
                      "x": 2440, "y": 0, "w": 900, "h": 1620, "page": "page-3"})
    artboards.append({"file": "Terms.dc.html", "title": "Terms and conditions",
                      "x": 3460, "y": 0, "w": 900, "h": 1480, "page": "page-3"})
    artboards.append({"file": "Components.dc.html", "title": "Field Signal system",
                      "x": 0, "y": 0, "w": 1200, "h": 1080, "page": "page-4"})

    canvas = {
        "pages": [
            {"id": "page-1", "name": "Phone"},
            {"id": "page-2", "name": "Desk"},
            {"id": "page-3", "name": "Board and public"},
            {"id": "page-4", "name": "System"},
        ],
        "artboards": artboards,
        "annotations": [
            {"id": "note-phone", "x": 0, "y": -260, "w": 460, "page": "page-1",
             "text": "PHONE - the eleven screens a volunteer actually uses.\n\n"
                     "Bottom tab bar is fixed at five floor entries so its shape never changes. "
                     "Everything else hangs off Home."},
            {"id": "note-shiftwork", "x": 1500, "y": -260, "w": 460, "page": "page-1",
             "text": "The work surface is the core loop: per-horse cards in stall order, one tap "
                     "per item, an Unsent count that is honest about the queue, and a close "
                     "button that names what is blocking it."},
            {"id": "note-desk", "x": 0, "y": -300, "w": 520, "page": "page-2",
             "text": "DESK - twelve admin screens, one shell.\n\nSidebar is gated on the write "
                     "each screen exists to perform, so a plain Volunteer sees General only. "
                     "Every screen is a table plus one form panel; that repetition is the point."},
            {"id": "note-board", "x": 0, "y": -260, "w": 520, "page": "page-3",
             "text": "BOARD is pinned light and read across a barn: full alert text, never a "
                     "count. Colour comes from the Product's kind, not a pen.\n\n"
                     "The three public pages are what a carrier reads during campaign vetting."},
            {"id": "note-system", "x": 1260, "y": 0, "w": 420, "page": "page-4",
             "text": "Every artboard is generated from design/build.py, so these tokens are the "
                     "single source. Change one here and re-run rather than editing 28 files."},
        ],
        "launch": {"view": "canvas", "page": "page-1"},
    }
    with open(os.path.join(HERE, "canvas.json"), "w", encoding="utf-8") as handle:
        json.dump(canvas, handle, indent=2)
    print(f"wrote {len(artboards)} artboards + canvas.json")


if __name__ == "__main__":
    main()
