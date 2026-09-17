# Eunomia dashboard — design DNA (concept: Kontrol odası / control room)

Chosen 2026-09-17 by Bekir over "Sözleşme sayfası" and "Sayaç". The owner's console for a
policy-bound agent treasury. Mercury/Ramp axis: rail + main column + aux column; the main
column is a live decision ledger, the aux column is the budget meter and the rules. The
marketing page's cream/green language carries over unchanged — same company, denser room.

## PALETTE (coverage per viewport)

| Token | Hex | Coverage | Job |
|---|---|---|---|
| cream `--bg` | #FCFFD5 | ~78% | canvas |
| surface `--surface` | #F4FADC | ~12% | panels, rail |
| ink `--ink` | #223E05 | ~7% | text · the ONE dark panel (verdict) |
| ink-2 `--ink-2` | #55693F | — | secondary text, eyebrows |
| green `--green` | #A2CB28 | ≤2% | FILL ONLY: allowed marks, meter fill, active nav tick. Never text (1.84:1 on cream). |
| red `--red` | #A62021 | <1% | blocked verdicts; works as text (7.16:1) |
| line | rgba(34,62,5,.16) | — | every panel edge, table rules |
| raise | rgba(34,62,5,.05) | — | active nav, hover, quiet fills |

Dark variant (option C only): bg #152A03 · surface #1E3A06 · ink #EDF6D2 · ink-2 #94A87A · line rgba(162,203,40,.24).

## TYPE (four roles, three families, three weights)

| Role | Face | Size / line | Note |
|---|---|---|---|
| display | Questrial 400 | 56/1.0 (verdict amount), 26/1.15 (page title) | wordmark only in Kalnia |
| numeric | JetBrains Mono 500, `font-variant-numeric: tabular-nums` | 40/1.0 hero meter · 14/1.4 table amounts | EVERY number that can change is mono |
| body | Geist 400/500 | 13.5/1.5 | copy, table text |
| eyebrow / label | Geist 500 | 11/1.2 uppercase, letter-spacing .08em | panel titles |

Ratios: verdict display 56 ÷ body 13.5 = 4.1× and meter 40 ÷ 13.5 = 3× — the 5× rule is met by the
verdict panel as a whole (dark panel ≈ 5× the height of a ledger row). Never more than 3 weights.

## SPACING

- Shell: rail 236px | content `minmax(0,1fr)`; topbar 56px; content max-width 1180, padding 24.
- Page grid: main `8fr` · aux `4fr` · gap 16. Bottom strip spans both.
- Panel: radius 14, padding 20, border 1px line, background surface. Ledger rows 44px (36 in the dark variant), row rule 1px line, amounts right-aligned.
- Rhythm: eyebrow → 8 → value → 12 → detail. Section gap 16. Nothing centered except the meter ring's number.

## LAYOUTS (named)

- **TOWER** — topbar: treasury chip left, wallet chip right, nothing else.
- **VERDICT** — the one dark panel: latest decision at display size, verdict pill, tx + who signed.
- **LEDGER** — the main column: what your rules did, newest first; verdict column is the only colour.
- **METER** — aux top: rolling 24h spend as a bar (A, B) or ring (C), per-payment cap beneath.
- **LEASH** — aux: agent key, cap bar, expiry countdown, revoke.
- **RULES** — aux bottom: daily · per payment · payees, three lines.
- **STRIP** — full-width bottom: seven days, allowed/blocked counts as paired bars.

## MOTION (Scatter & Settle tokens from DESIGN.md)

`--e-out-expo` for rows arriving (translateY 8→0, 8f), `--e-back-out` for the verdict pill (4% overshoot),
meter fill springs on load (12f), no opacity-only entrances. Ledger insert = swap in place, rows below shift. Exit 65% of enter.

## THE MOVE

One dark panel on a cream page: the latest verdict sits in ink with cream type and glows (the only glow). Everything else is flat cream — the rule "light scenes are flat" broken exactly once, where the decision is.

## REFUSALS

- No gradients (static), no shadows, no emoji, no illustrative SVG. Icons only in the rail, 16px stroke, one set.
- No equal-width card grids; no card whose only content is an empty-state sentence (empty = one muted ledger line).
- No left-accent-bordered boxes (the old "Send a payment" banner). No centered layouts.
- Green never carries text. Red never fills. At most one dark surface per viewport (C is entirely dark: then at most one glowing element).
- No "Send payment" as the first action of the Overview: the page reports what the rules did; manual pay lives in Payments as an escape hatch.
- No Inter / Fraunces on product surfaces.

## TESTS (a bad copy fails at least one)

1. Cover the ledger: is anything left worth looking at? If yes, the ledger is not the hero.
2. Count dark surfaces per viewport: more than one = fail (C: more than one glow = fail).
3. Find a number set in Geist or Questrial that can change: fail.
4. Find green text or a red fill: fail.
5. Find a panel with no live value in it: fail.
