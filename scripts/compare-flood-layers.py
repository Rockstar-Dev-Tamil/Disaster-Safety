"""
Does HAND tell us anything Aqueduct does not?

Three rasters share the Majuli analysis grid, 893 x 891 at 100 m:

    floodrp.png   WRI Aqueduct, class by smallest inundating return period
    hand.png      Height Above Nearest Drainage, class by calibrated breaks
    flood.png     observed extent, years flooded of 1999 / 2000 / 2004

THE CONTAMINATION, STATED UP FRONT
----------------------------------
HAND's class breaks were FITTED to the observed composite -- the 0.50 / 0.20 /
0.05 crossings came straight out of it. So "HAND agrees with observed extent
better than Aqueduct does" is guaranteed by construction and proves nothing.
Any comparison that rests on it is circular.

What is NOT circular: Aqueduct never saw the composite. So

    cells Aqueduct calls Negligible that observably flooded

is a clean measure of Aqueduct's false negatives. The question HAND has to
answer is whether it recovers them -- and the honest way to score that is
LIFT over HAND's own base rate, not raw agreement. If HAND calls 32% of all
ground High-or-Moderate and calls 35% of Aqueduct's misses High-or-Moderate,
it is adding nothing; the fitting bias inflates both numbers equally and
cancels in the ratio.

SPATIAL COHERENCE
-----------------
A disagreement scattered as single cells is noise from resampling a 900 m
product onto a 100 m grid. One that forms contiguous blobs is a real feature
the coarse model missed. Reported as mean 4-neighbour count: ~4 is solid
blobs, near 0 is salt and pepper.
"""
import os
import sys

import numpy as np
from PIL import Image

STACK = 'public/terrain-assam'
SCALE = 80
UNDETERMINED = 255

AQ_LABEL = {3: 'High (RP<=10)', 2: 'Moderate (11-100)', 1: 'Low (101-1000)',
            0: 'Negligible (dry)'}
HAND_LABEL = {3: 'High (<=3.3m)', 2: 'Moderate (<=18m)', 1: 'Low (<=32m)',
              0: 'Negligible'}


def load(name):
    p = os.path.join(STACK, f'{name}.png')
    if not os.path.exists(p):
        print(f'missing {p}')
        sys.exit(1)
    return np.asarray(Image.open(p).convert('L'), dtype='uint8')


def coherence(mask):
    """Mean 4-neighbour count among the masked cells."""
    if mask.sum() == 0:
        return 0.0
    v = mask[1:, :] & mask[:-1, :]
    h = mask[:, 1:] & mask[:, :-1]
    return 2.0 * (v.sum() + h.sum()) / mask.sum()


def main():
    aq_raw, hand_raw, obs_raw = load('floodrp'), load('hand'), load('flood')
    shape = aq_raw.shape
    print(f'grid {shape[1]} x {shape[0]}  ({aq_raw.size:,} cells)\n')

    aq = (aq_raw // SCALE).astype('int8')
    hand = np.where(hand_raw == UNDETERMINED, -1, hand_raw // SCALE).astype('int8')
    obs_years = (obs_raw // SCALE).astype('int8')
    observed = obs_years >= 1
    resolved = hand >= 0

    print(f'observed flooded (1999/2000/2004): {observed.mean() * 100:.1f}%')
    print(f'HAND unresolved (excluded below):  {(~resolved).mean() * 100:.1f}%\n')

    # ---- cross-tabulation
    print('CROSS-TAB, share of grid (rows Aqueduct, cols HAND)')
    print(f'{"":<20}' + ''.join(f'{HAND_LABEL[c].split(" ")[0]:>12}' for c in (3, 2, 1, 0)))
    for a in (3, 2, 1, 0):
        row = ''.join(
            f'{((aq == a) & (hand == c)).mean() * 100:>11.1f}%' for c in (3, 2, 1, 0))
        print(f'{AQ_LABEL[a]:<20}{row}')

    agree = ((aq == hand) & resolved).mean() * 100
    print(f'\nexact class agreement: {agree:.1f}%')

    # ---- the clean measure: Aqueduct's false negatives
    aq_dry = (aq == 0) & resolved
    misses = aq_dry & observed
    print(f'\n--- AQUEDUCT MISSES (clean: Aqueduct never saw the composite)')
    print(f'  Aqueduct says Negligible          {aq_dry.mean() * 100:>6.1f}% of grid')
    print(f'  ...of which observably flooded    {misses.sum() / max(aq_dry.sum(), 1) * 100:>6.1f}%'
          f'   ({int(misses.sum()):,} cells)')

    # ---- does HAND recover them? scored as lift over its own base rate
    hand_flags = hand >= 2                      # High or Moderate
    base = hand_flags[resolved].mean()
    on_misses = hand_flags[misses].mean() if misses.sum() else 0.0
    print(f'\n--- DOES HAND RECOVER THEM?')
    print(f'  HAND flags High/Moderate, everywhere      {base * 100:>6.1f}%   (base rate)')
    print(f'  HAND flags High/Moderate, on the misses   {on_misses * 100:>6.1f}%')
    lift = (on_misses / base) if base else 0.0
    print(f'  lift                                      {lift:>6.2f}x')
    print('  (1.0 = HAND is guessing at its own base rate and adds nothing;')
    print('   the fitting bias inflates both terms and cancels in the ratio)')

    # ---- and the converse: does HAND fire where nothing floods?
    quiet = aq_dry & ~observed
    fp = hand_flags[quiet].mean() if quiet.sum() else 0.0
    print(f'\n  HAND flags High/Moderate on Aqueduct-dry AND observably dry '
          f'{fp * 100:.1f}%')
    print(f'  ({int((hand_flags & quiet).sum()):,} cells — the cost of acting on HAND alone)')

    # ---- spatial coherence of the disagreement
    dis = aq_dry & hand_flags
    print(f'\n--- SPATIAL CHARACTER OF THE DISAGREEMENT')
    print(f'  Aqueduct-dry but HAND High/Moderate: {dis.sum() / max(aq_dry.sum(), 1) * 100:.1f}% '
          f'of Aqueduct-dry ({int(dis.sum()):,} cells)')
    print(f'  mean 4-neighbour count: {coherence(dis):.2f}   '
          f'(~4 solid blobs, ~0 salt and pepper)')
    print(f'  for reference, Aqueduct High itself:  {coherence(aq == 3):.2f}')

    # ---- the reverse quadrant
    aq_high = (aq == 3) & resolved
    rev = aq_high & (hand == 0)
    print(f'\n--- REVERSE: Aqueduct High, HAND Negligible')
    print(f'  {rev.sum() / max(aq_high.sum(), 1) * 100:.1f}% of Aqueduct High '
          f'({int(rev.sum()):,} cells)')
    print(f'  ...of which observably flooded: '
          f'{observed[rev].mean() * 100 if rev.sum() else 0:.1f}%'
          f'   vs {observed[aq_high].mean() * 100:.1f}% across all Aqueduct High')
    return 0


if __name__ == '__main__':
    sys.exit(main())
