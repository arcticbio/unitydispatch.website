# Usage: python3 scripts/chat-pattern.py  (needs numpy + scikit-image)
# Generates a seamless topographic-contour tile (original artwork) for the chat background.
import numpy as np
from skimage import measure
rng = np.random.default_rng(7)
N = 340                     # tile size in px
G = 170                     # sampling grid
x = np.linspace(0, 2*np.pi, G, endpoint=False)
X, Y = np.meshgrid(x, x)
Z = np.zeros_like(X)
for _ in range(26):          # integer frequencies keep the field periodic -> tileable
    fx, fy = rng.integers(-5, 6, 2)
    if fx == 0 and fy == 0: continue
    amp = 1 / np.hypot(fx, fy) ** 1.3
    Z += amp * np.sin(fx * X + fy * Y + rng.uniform(0, 2*np.pi))
# wrap-pad so contours continue across the tile edge, then crop on output
Zp = np.pad(Z, 2, mode='wrap')
levels = np.linspace(Z.min(), Z.max(), 16)[1:-1]
scale = N / G
paths = []
for lv in levels:
    for c in measure.find_contours(Zp, lv):
        c = measure.approximate_polygon(c, tolerance=0.35)
        if len(c) < 3: continue
        pts = [((p[1]-2)*scale, (p[0]-2)*scale) for p in c]
        d = 'M' + ' '.join(f'{px:.1f},{py:.1f}' for px, py in pts)
        paths.append(d)
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{N}" height="{N}" viewBox="0 0 {N} {N}">'
       f'<path fill="none" stroke="#d4d2d2" stroke-width="0.9" d="{" ".join(paths)}"/></svg>')
open(__import__('pathlib').Path(__file__).resolve().parent.parent / 'site/assets/img/chat-pattern.svg', 'w').write(svg)
print(len(svg), len(paths))
