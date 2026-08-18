# PWA icon source (#48)

`source.svg` and `maskable.svg` are the source for `public/icons/*.png`. They
live here, outside `public/`, so the bundle ships the rasterised icons the
manifest names and nothing else — the SVGs are a design input, not part of the
installable shell.

Regenerate with ImageMagick's `rsvg-convert` (or any SVG rasteriser) from the
repo root:

```
rsvg-convert -w 192 -h 192 docs/pwa-icons/source.svg -o public/icons/icon-192.png
rsvg-convert -w 512 -h 512 docs/pwa-icons/source.svg -o public/icons/icon-512.png
rsvg-convert -w 180 -h 180 docs/pwa-icons/source.svg -o public/icons/apple-touch-icon.png
rsvg-convert -w 512 -h 512 docs/pwa-icons/maskable.svg -o public/icons/icon-512-maskable.png
```

`maskable.svg` differs from `source.svg` only in that it fills the full
square with no rounded-corner inset: a maskable icon's safe zone is the
platform's job to crop, and content that already assumes rounded corners gets
double-rounded on a platform that also masks it.
