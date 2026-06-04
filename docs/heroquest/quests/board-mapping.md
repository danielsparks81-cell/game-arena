# Quest Book → locked board mapping

How we translate any Quest Book quest onto our locked 30×23 board
(`templateBoard.ts`). The board was built so the **numbered rooms are identical
to the book** (same size + shape); only the **unnumbered rooms and the halls were
enlarged** (to widen chokepoints). So translation splits into: exact 1:1 for the
numbered rooms, and a small ruleset for everything that grew.

## 1. Numbered rooms 1–14 — EXACT 1:1

These match the book cell-for-cell. Translate **corner-to-corner**: a book cell at
in-room offset (dx, dy) → our cell `(roomTopLeftCol + dx, roomTopLeftRow + dy)`.
Coordinates are `(col, row)`.

| # | Our cells | Size | Notes |
|---|-----------|------|-------|
| 1 | cols 20–23, rows 2–5 | 4×4 | |
| 2 | cols 24–27, rows 2–5 | 4×4 | |
| 3 | cols 2–5, rows 6–10 | 4×5 | |
| 4 | cols 6–9, rows 6–10 | 4×5 | |
| 5 | cols 12–17, rows 9–13 | 6×5 | central chamber |
| 6 | cols 2–5, rows 13–16 | 4×4 | |
| 7 | cols 6–7, rows 13–15 | 2×3 | |
| 8 | cols 8–9, rows 13–15 | 2×3 | |
| 9 | cols 2–5, rows 17–20 | 4×4 | entrance; stairs (2,17)(3,17)(2,18)(3,18) |
| 10 | cols 6–9, rows 16–20 | 4×5 | |
| 11 | cols 20–23, rows 13–16 (minus cell 20,16) | 15-cell L | unique L-room (matches book) |
| 12 | cols 24–27, rows 13–16 | 4×4 | |
| 13 | cols 21–23, rows 17–20 | 3×4 | |
| 14 | cols 24–27, rows 17–20 | 4×4 | |

## 2. The enlarged parts — ruleset (LOCKED)

All rooms get used by some quest, so these rules apply throughout.

### Wider halls (book 1-wide → our 2-wide)
- A hall follows the **same route between the same rooms**; ours just has an extra
  lane.
- A corridor monster / wandering-monster spawn → the **matching point** of our
  hall, on the lane the book shows it (either lane is fine for spawns).
- **Blocking trap** (falling block) → make it **double-wide** (both lanes). It is
  triggered by **either** square, and when triggered the **block falls on both**
  squares, sealing the whole hall. (Engine: a 2-cell linked falling block.)
- A **dodge-able** trap (pit/spear) → a single lane.
- **Doors** stay on the room wall at the book's position; they now open into the
  2-wide hall.

### Enlarged (unnumbered) rooms
- **Furniture touching a wall** in the book → keep it **against that same wall**
  in our room (north stays north, etc.). The extra floor stays empty.
- Furniture **not** touching a wall (e.g. a central table) → keep it **centred**.
- **Monsters** → keep each monster the **same distance from the door(s)** as in
  the book, whenever the larger room allows (they guard the same approach).
- **Objective / treasure** rides with its furniture (it's attached to a chest /
  tomb / etc.).

## 3. Stairway (per quest)
Place the staircase (one space, 2×2) in the room matching the book's start corner;
put the heroes' 4 start cells on it. **Quest 1 → room #9, stairs (2,17)(3,17)(2,18)(3,18).**
