"""Renders the opening sample's clean source clips at 1920x1080, 30 fps.

The motion is procedural, from the approval animatic's `render_proposal.py`
(`art`) with its v2 colour treatment (`render_v2.py`, `source`), scaled to
the final resolution. Only the clean sources are rendered here: every cut,
arrangement, effect and title in the sample is built natively in zvid.

    python app/scripts/sample/render_sources.py [OUTPUT_DIR] [--seconds N]

Needs Pillow and ffmpeg on PATH. Each clip renders in its own process.
"""

import math
import pathlib
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

W, H = 1920, 1080
S = W / 960  # The animatic's 960x540 geometry, scaled up.
FPS = 30
BG = (5, 9, 18)

# Name, dark and light colour of each source.
SOURCES = [
    ("orbit", (12, 61, 89), (87, 246, 206)),
    ("ribbon", (89, 23, 69), (255, 178, 95)),
    ("corridor", (35, 40, 96), (184, 191, 255)),
]


def mix(a, b, f):
    return tuple(int(x + (y - x) * f) for x, y in zip(a, b))


def art(kind, t):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    phase = t * math.tau / 8
    line = max(1, round(S))
    if kind == 0:
        # Orbital wire sculpture.
        for j in range(34):
            pts = []
            for i in range(361):
                a = i * math.tau / 360
                r = (145 + j * 2.1) * S
                x, y = math.cos(a) * r, math.sin(a) * r
                z = math.sin(a * 2 + phase + j * 0.045) * 42 * S
                ang = phase * 0.25 + 0.4
                pts.append(
                    (
                        W / 2 + x * math.cos(ang) - y * 0.34 * math.sin(ang),
                        H / 2 + x * math.sin(ang) + y * 0.34 * math.cos(ang) + z,
                    )
                )
            d.line(pts, fill=mix((22, 69, 82), (123, 240, 222), j / 34), width=line)
    elif kind == 1:
        # Flowing ribbon.
        for j in range(48):
            pts = []
            for i in range(200):
                x = i * W / 199
                y = (
                    H * 0.5
                    + math.sin(i / 199 * math.tau + phase + j * 0.035) * 90 * S
                    + (j - 24) * 3.1 * S
                )
                pts.append((x, y))
            d.line(pts, fill=mix((41, 55, 103), (242, 166, 105), j / 48), width=line)
    else:
        # Perspective corridor.
        for j in range(24):
            p = ((j / 24 + t / 8) % 1) ** 2
            ww = (40 + p * 1040) * S
            hh = (20 + p * 570) * S
            cx = W / 2 + math.sin(phase) * 30 * S * (1 - p)
            cy = H / 2
            c = mix((19, 30, 47), (103, 159, 189), p)
            d.polygon(
                [
                    (cx - ww / 2, cy - hh / 2),
                    (cx + ww / 2, cy - hh / 2),
                    (cx + ww / 2, cy + hh / 2),
                    (cx - ww / 2, cy + hh / 2),
                ],
                outline=c,
                width=line,
            )
        d.line((80 * S, 420 * S, 880 * S, 120 * S), fill=(186, 210, 209), width=2 * line)
    glow = im.filter(ImageFilter.GaussianBlur(5 * S))
    return ImageChops.add(im, glow, scale=1.35)


def source(kind, t):
    _, dark, light = SOURCES[kind]
    gray = ImageOps.autocontrast(ImageOps.grayscale(art(kind, t)))
    return ImageOps.colorize(gray, dark, light)


def render(kind, out_dir, seconds):
    name = SOURCES[kind][0]
    path = out_dir / f"{name}.mp4"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", "25", "-tune", "animation",
        "-pix_fmt", "yuv420p", "-g", str(FPS), "-movflags", "+faststart",
        "-metadata", f"title=zvid sample source: {name}",
        str(path),
    ]
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for frame in range(seconds * FPS):
        process.stdin.write(source(kind, frame / FPS).tobytes())
    process.stdin.close()
    if process.wait():
        raise RuntimeError(f"ffmpeg failed for {name}")
    return path


def main():
    args = sys.argv[1:]
    seconds = 16
    if "--seconds" in args:
        index = args.index("--seconds")
        seconds = int(args[index + 1])
        del args[index : index + 2]
    out_dir = pathlib.Path(args[0] if args else ".")
    out_dir.mkdir(parents=True, exist_ok=True)
    with ProcessPoolExecutor(len(SOURCES)) as pool:
        for path in pool.map(
            render, range(len(SOURCES)), [out_dir] * 3, [seconds] * 3
        ):
            print("Rendered", path, flush=True)


if __name__ == "__main__":
    main()
