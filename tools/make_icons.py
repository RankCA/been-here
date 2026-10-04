#!/usr/bin/env python3
"""Draw the app icon (fog with a cleared trail and a pin) with no libraries.

Usage: python3 tools/make_icons.py
Writes icons/icon-180.png, icon-192.png and icon-512.png.
"""
import math
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 1024  # master size


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def catmull(pts, n):
    out = []
    p = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    out.append(pts[-1])
    return out


def build_mask():
    """Where the fog is cleared: a winding trail plus two explored patches."""
    mask = [0.0] * (S * S)
    trail = catmull([(0.08, 0.92), (0.26, 0.66), (0.47, 0.70), (0.60, 0.46), (0.76, 0.32)], 60)

    def stamp(cx, cy, r, edge):
        x0, x1 = int((cx - r - edge) * S), int((cx + r + edge) * S) + 1
        y0, y1 = int((cy - r - edge) * S), int((cy + r + edge) * S) + 1
        for y in range(max(0, y0), min(S, y1)):
            fy = (y + 0.5) / S - cy
            row = y * S
            for x in range(max(0, x0), min(S, x1)):
                fx = (x + 0.5) / S - cx
                d = math.sqrt(fx * fx + fy * fy)
                v = 1 - smooth(r, r + edge, d)
                if v > mask[row + x]:
                    mask[row + x] = v

    for cx, cy in trail[::2]:
        stamp(cx, cy, 0.058, 0.03)
    stamp(0.27, 0.66, 0.12, 0.05)
    stamp(0.60, 0.47, 0.10, 0.05)
    return mask


def noise_fn(seed):
    import random
    rnd = random.Random(seed)
    n = 6
    g = [[rnd.random() for _ in range(n + 1)] for _ in range(n + 1)]

    def f(x, y):
        fx, fy = x * n, y * n
        x0, y0 = int(fx), int(fy)
        tx, ty = fx - x0, fy - y0
        sx, sy = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
        x0, y0 = min(x0, n - 1), min(y0, n - 1)
        a, b = g[y0][x0], g[y0][x0 + 1]
        c, d = g[y0 + 1][x0], g[y0 + 1][x0 + 1]
        return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
    return f


def render():
    mask = build_mask()
    nz = noise_fn(3)
    fog_top, fog_bot = hexrgb("#1a2b52"), hexrgb("#0a1226")
    land, road, major, water, park = hexrgb("#f2ead6"), hexrgb("#ffffff"), hexrgb("#ffcf73"), hexrgb("#8ccbec"), hexrgb("#c4e6b4")
    coral, white = hexrgb("#ff6a3d"), (255, 255, 255)
    pin = (0.76, 0.32)
    ang = math.radians(22)
    ca, sa = math.cos(ang), math.sin(ang)
    px = bytearray(S * S * 3)
    for y in range(S):
        fy = (y + 0.5) / S
        fog_row = mix(fog_top, fog_bot, fy)
        for x in range(S):
            fx = (x + 0.5) / S
            m = mask[y * S + x]
            # fog with soft cloud texture
            cl = nz(fx, fy) * 0.6 + nz(fy * 0.7 + 0.1, fx * 0.7 + 0.2) * 0.4
            col = mix(fog_row, (70, 92, 140), max(0.0, cl - 0.45) * 0.55)
            if m > 0:
                # the map underneath
                u, v = fx * ca + fy * sa, -fx * sa + fy * ca
                c = land
                if (fx - 0.47) ** 2 + (fy - 0.76) ** 2 < 0.07 ** 2:
                    c = park
                if abs(fy - (0.55 + 0.07 * math.sin(fx * 9))) < 0.022:
                    c = water
                gu, gv = (u * 9) % 1, (v * 9) % 1
                if min(gu, 1 - gu) < 0.06 or min(gv, 1 - gv) < 0.06:
                    c = road
                if abs(v - 0.30) < 0.016:
                    c = major
                col = mix(col, c, m)
            # pin
            d = math.sqrt((fx - pin[0]) ** 2 + (fy - pin[1]) ** 2)
            if d < 0.098:
                col = mix(col, white, 1 - smooth(0.092, 0.098, d))
                if d < 0.078:
                    col = mix(col, coral, 1 - smooth(0.072, 0.078, d))
                if d < 0.032:
                    col = mix(col, white, 1 - smooth(0.027, 0.032, d))
            i = (y * S + x) * 3
            px[i], px[i + 1], px[i + 2] = int(col[0]), int(col[1]), int(col[2])
    return px


def downscale(px, size):
    out = bytearray(size * size * 3)
    f = S / size
    for y in range(size):
        y0, y1 = y * f, (y + 1) * f
        for x in range(size):
            x0, x1 = x * f, (x + 1) * f
            acc = [0.0, 0.0, 0.0]
            wsum = 0.0
            for sy in range(int(y0), min(S, int(math.ceil(y1)))):
                wy = min(y1, sy + 1) - max(y0, sy)
                for sx in range(int(x0), min(S, int(math.ceil(x1)))):
                    w = wy * (min(x1, sx + 1) - max(x0, sx))
                    i = (sy * S + sx) * 3
                    acc[0] += px[i] * w
                    acc[1] += px[i + 1] * w
                    acc[2] += px[i + 2] * w
                    wsum += w
            o = (y * size + x) * 3
            out[o], out[o + 1], out[o + 2] = (int(round(a / wsum)) for a in acc)
    return out


def write_png(path, px, size):
    raw = b"".join(b"\x00" + bytes(px[y * size * 3:(y + 1) * size * 3]) for y in range(size))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    open(path, "wb").write(png)


if __name__ == "__main__":
    os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
    master = render()
    for size in (512, 192, 180):
        write_png(os.path.join(ROOT, "icons", "icon-%d.png" % size), downscale(master, size), size)
        print("icon", size)
