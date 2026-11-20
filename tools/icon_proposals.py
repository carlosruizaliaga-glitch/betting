"""Propuestas de icono para Betting al estilo del icono de Zontes 125X:
fondo crema, dibujo geométrico facetado (low-poly) en negro y crema, acento naranja y marco hexagonal partido.
Uso: python tools/icon_proposals.py carpeta_destino  → icono-A.png … icono-F.png y propuestas.png (hoja con todas).
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

N = 1024                         # se dibuja a 1024 y se reduce a 512
PAL = {
    'crema':   dict(bg=((246, 238, 226), (233, 221, 203)), ink=(28, 26, 26), mid=(78, 72, 68), light=(250, 245, 237), shade=(214, 202, 186), acc=(240, 96, 24), frame=(40, 38, 38)),
    'grafito': dict(bg=((44, 48, 50), (24, 27, 29)), ink=(238, 232, 220), mid=(170, 164, 154), light=(58, 63, 66), shade=(36, 40, 43), acc=(67, 232, 192), frame=(210, 204, 192)),
    'menta':   dict(bg=((77, 233, 196), (44, 207, 174)), ink=(16, 40, 36), mid=(18, 96, 80), light=(214, 250, 239), shade=(150, 222, 202), acc=(255, 211, 110), frame=(16, 40, 36)),
    'tapete':  dict(bg=((22, 110, 72), (10, 70, 44)), ink=(246, 238, 220), mid=(200, 190, 168), light=(20, 92, 60), shade=(16, 80, 52), acc=(242, 196, 82), frame=(246, 238, 220)),
    'burdeos': dict(bg=((122, 30, 48), (78, 16, 30)), ink=(250, 236, 214), mid=(214, 190, 160), light=(110, 26, 42), shade=(94, 20, 36), acc=(244, 190, 92), frame=(250, 236, 214)),
    'naranja': dict(bg=((255, 128, 48), (236, 92, 22)), ink=(28, 22, 20), mid=(80, 50, 36), light=(255, 214, 180), shade=(250, 170, 120), acc=(255, 255, 255), frame=(28, 22, 20)),
    'amarillo':dict(bg=((255, 214, 72), (246, 186, 30)), ink=(26, 24, 22), mid=(84, 74, 58), light=(255, 240, 190), shade=(240, 206, 120), acc=(214, 40, 56), frame=(26, 24, 22)),
    'rojo':    dict(bg=((236, 64, 72), (196, 34, 48)), ink=(255, 244, 232), mid=(250, 200, 190), light=(214, 52, 62), shade=(190, 40, 52), acc=(26, 22, 24), frame=(255, 244, 232)),
    'violeta': dict(bg=((74, 42, 128), (44, 22, 84)), ink=(250, 240, 255), mid=(200, 184, 230), light=(66, 38, 114), shade=(56, 30, 98), acc=(255, 120, 190), frame=(250, 240, 255)),
    'real':    dict(bg=((40, 92, 220), (24, 56, 160)), ink=(255, 255, 255), mid=(196, 212, 250), light=(36, 82, 200), shade=(30, 70, 180), acc=(190, 240, 60), frame=(255, 255, 255)),
    'arena':   dict(bg=((240, 230, 210), (222, 206, 178)), ink=(22, 70, 74), mid=(60, 120, 124), light=(248, 242, 230), shade=(220, 208, 186), acc=(230, 80, 60), frame=(22, 70, 74)),
    'noche':   dict(bg=((24, 34, 46), (12, 18, 26)), ink=(246, 240, 228), mid=(150, 160, 170), light=(36, 48, 62), shade=(28, 38, 50), acc=(255, 190, 70), frame=(220, 214, 200)),
}


def tile(p):
    top, bot = p['bg']
    g = Image.new('RGBA', (N, N))
    d = ImageDraw.Draw(g)
    for y in range(N):
        t = y / (N - 1)
        d.line([(0, y), (N, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    m = Image.new('L', (N, N), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, N - 1, N - 1], radius=int(N * .225), fill=255)
    out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    out.paste(g, (0, 0), m)
    # brillo suave arriba (como el azulejo de Zontes)
    hi = Image.new('L', (N, N), 0)
    ImageDraw.Draw(hi).ellipse([-N * .2, -N * .75, N * 1.2, N * .35], fill=38)
    hi = hi.filter(ImageFilter.GaussianBlur(N * .05))
    white = Image.new('RGBA', (N, N), (255, 255, 255, 255))
    out = Image.composite(white, out, Image.eval(hi, lambda v: v)).copy()
    out.putalpha(m)
    return out


def seg(d, a, b, w, col):
    """Trazo recto con puntas en bisel (como los del marco de Zontes)."""
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    nx, ny = -math.sin(ang) * w / 2, math.cos(ang) * w / 2
    d.polygon([(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)], fill=col)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def poly_stroke(d, pts, w, col):
    """Trazo por varios puntos con esquinas cerradas (cada tramo se alarga medio grosor en las uniones)."""
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
        ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        e0 = w / 2 if i > 0 else 0
        e1 = w / 2 if i < len(pts) - 2 else 0
        seg(d, (a[0] - ux * e0, a[1] - uy * e0), (b[0] + ux * e1, b[1] + uy * e1), w, col)


def frame(d, p, r=.43, w=.02):
    """Hexágono abierto: tramo de acento que sube por la izquierda y tramos oscuros con huecos (como Zontes)."""
    c, R = N / 2, N * r
    v = [(c + R * math.cos(math.radians(a)), c + R * math.sin(math.radians(a))) for a in (180, 240, 300, 0, 60, 120)]
    W = N * w
    poly_stroke(d, [lerp(v[5], v[0], .55), v[0], v[1], lerp(v[1], v[2], .72)], W, p['acc'] + (255,))
    poly_stroke(d, [lerp(v[1], v[2], .86), v[2], lerp(v[2], v[3], .62)], W * .85, p['frame'] + (255,))
    poly_stroke(d, [lerp(v[2], v[3], .82), v[3], v[4], lerp(v[4], v[5], .58)], W, p['frame'] + (255,))


def shape_fill(im, poly, p, cuts):
    """Rellena una forma con el tono oscuro y le superpone facetas (polígonos recortados a la forma)."""
    m = Image.new('L', (N, N), 0)
    ImageDraw.Draw(m).polygon(poly, fill=255)
    lay = Image.new('RGBA', (N, N), p['ink'] + (255,))
    dl = ImageDraw.Draw(lay)
    for pts, col in cuts:
        dl.polygon(pts, fill=col + (255,))
    im.paste(lay, (0, 0), m)
    return m


def facets(d, poly, center, cols):
    """Rellena un polígono en triángulos desde un punto interior con tonos alternos (efecto facetado)."""
    for i in range(len(poly)):
        d.polygon([center, poly[i], poly[(i + 1) % len(poly)]], fill=cols[i % len(cols)] + (255,))


# ---------- símbolos ----------
def ball(im, p, accent_arrow=False):
    c, R = N / 2, N * .23
    d = ImageDraw.Draw(im)
    circle = Image.new('L', (N, N), 0)
    ImageDraw.Draw(circle).ellipse([c - R, c - R, c + R, c + R], fill=255)
    lay = Image.new('RGBA', (N, N), p['light'] + (255,))
    dl = ImageDraw.Draw(lay)
    # facetas claras (dos tonos) para el volumen
    rim = [(c + R * 1.1 * math.cos(math.radians(a)), c + R * 1.1 * math.sin(math.radians(a))) for a in range(-90, 270, 36)]
    for i in range(len(rim)):
        if i % 2: dl.polygon([(c + R * .25, c + R * .3), rim[i], rim[(i + 1) % len(rim)]], fill=p['shade'] + (255,))
    pr = R * .38
    ang = [-90 + 72 * k for k in range(5)]
    pent = [(c + pr * math.cos(math.radians(a)), c + pr * math.sin(math.radians(a))) for a in ang]
    lw = int(N * .012)
    for k, a in enumerate(ang):                       # costuras hacia el borde
        e = (c + R * .78 * math.cos(math.radians(a)), c + R * .78 * math.sin(math.radians(a)))
        dl.line([pent[k], e], fill=p['ink'] + (255,), width=lw)
    for k in range(5):                                # parches del borde
        a = math.radians(-90 + 72 * k + 36)
        cx, cy = c + R * 1.0 * math.cos(a), c + R * 1.0 * math.sin(a)
        q = [(cx + pr * .95 * math.cos(a + math.pi + math.radians(72 * j)), cy + pr * .95 * math.sin(a + math.pi + math.radians(72 * j))) for j in range(5)]
        dl.polygon(q, fill=p['ink'] + (255,))
        dl.polygon([q[0], q[1], (cx, cy)], fill=p['mid'] + (255,))
    dl.polygon(pent, fill=p['ink'] + (255,))
    dl.polygon([pent[0], pent[1], (c, c)], fill=p['mid'] + (255,))
    dl.polygon([pent[3], pent[4], (c, c)], fill=p['mid'] + (255,))
    im.paste(lay, (0, 0), circle)
    d.ellipse([c - R, c - R, c + R, c + R], outline=p['ink'] + (255,), width=int(N * .014))
    if accent_arrow:
        a0, a1 = (c - R * 1.35, c + R * 1.2), (c + R * 1.3, c - R * 1.05)
        seg(d, a0, a1, N * .026, p['acc'] + (255,))
        tip = (a1[0] + N * .03, a1[1] - N * .03)
        d.polygon([tip, (tip[0] - N * .085, tip[1] + N * .012), (tip[0] - N * .012, tip[1] + N * .085)], fill=p['acc'] + (255,))


def ticket(im, p):
    d = ImageDraw.Draw(im)
    c = N / 2
    w, h = N * .38, N * .48
    x0, y0, x1, y1 = c - w / 2, c - h / 2, c + w / 2, c + h / 2
    ny, nr = y0 + h * .64, N * .042
    poly = [(x0, y0), (x1, y0), (x1, ny - nr), (x1 - nr, ny), (x1, ny + nr), (x1, y1), (x0, y1), (x0, ny + nr), (x0 + nr, ny), (x0, ny - nr)]
    shape_fill(im, poly, p, [([(x0, y0), (x1, y0), (x1, y0 + h * .35)], p['mid']), ([(x0, y1), (x0, y1 - h * .3), (x1, y1)], p['mid'])])
    for i in range(7):
        xa = x0 + nr + N * .02 + i * (w - 2 * nr - N * .02) / 7
        d.line([(xa, ny), (xa + N * .02, ny)], fill=p['light'] + (255,), width=int(N * .008))
    s_ = N * .16
    pts = [(c - s_ * .55, y0 + h * .34), (c - s_ * .12, y0 + h * .50), (c + s_ * .62, y0 + h * .16)]
    seg(d, pts[0], pts[1], N * .048, p['acc'] + (255,))
    seg(d, pts[1], pts[2], N * .048, p['acc'] + (255,))
    d.ellipse([pts[1][0] - N * .024, pts[1][1] - N * .024, pts[1][0] + N * .024, pts[1][1] + N * .024], fill=p['acc'] + (255,))


def trend(im, p):
    d = ImageDraw.Draw(im)
    c = N / 2
    base = c + N * .19
    xs = [c - N * .25, c - N * .13, c - N * .02, c + N * .10, c + N * .24]
    ys = [c + N * .06, c - N * .03, c + N * .04, c - N * .11, c - N * .22]
    # montaña facetada bajo la línea
    for i in range(4):
        col = [p['ink'], p['mid']][i % 2]
        d.polygon([(xs[i], ys[i]), (xs[i + 1], ys[i + 1]), (xs[i + 1], base), (xs[i], base)], fill=col + (255,))
        d.polygon([(xs[i], ys[i]), (xs[i + 1], base), (xs[i], base)], fill=[p['mid'], p['ink']][i % 2] + (255,))
    for i in range(4):
        seg(d, (xs[i], ys[i]), (xs[i + 1], ys[i + 1]), N * .03, p['acc'] + (255,))
    tip = (xs[-1] + N * .05, ys[-1] - N * .05)
    d.polygon([tip, (tip[0] - N * .095, tip[1] + N * .01), (tip[0] - N * .01, tip[1] + N * .095)], fill=p['acc'] + (255,))


def monogram(im, p):
    d = ImageDraw.Draw(im)
    c = N / 2
    x0, x1, y0, y1, ym = c - N * .16, c + N * .15, c - N * .22, c + N * .22, c - N * .015
    k = N * .06
    poly = [(x0, y0), (x1 - k, y0), (x1, y0 + k), (x1, ym - k * .7), (x1 - k * .5, ym), (x1 + N * .03, ym + k * .6), (x1 + N * .03, y1 - k), (x1 + N * .03 - k, y1), (x0, y1)]
    shape_fill(im, poly, p, [([(x0, y0), (x1, y0), (x1, ym)], p['mid']), ([(x0, ym), (x1 + N * .05, ym), (x1 + N * .05, y1)], p['mid'])])
    t = N * .075
    d.polygon([(x0 + t * 1.3, y0 + t), (x1 - t * 1.1, y0 + t), (x1 - t * .9, ym - t * .8), (x0 + t * 1.3, ym - t * .8)], fill=p['light'] + (255,))
    d.polygon([(x0 + t * 1.3, ym + t * .8), (x1 - t * .6, ym + t * .8), (x1 - t * .6, y1 - t), (x0 + t * 1.3, y1 - t)], fill=p['light'] + (255,))
    seg(d, (x0 - N * .1, y1 + N * .03), (x1 + N * .12, y0 - N * .05), N * .026, p['acc'] + (255,))


DESIGNS = [
    ('B1', 'Boleto', 'tapete', ticket), ('B2', 'Boleto', 'burdeos', ticket), ('B3', 'Boleto', 'naranja', ticket), ('B4', 'Boleto', 'amarillo', ticket),
    ('B5', 'Boleto', 'rojo', ticket), ('B6', 'Boleto', 'violeta', ticket), ('B7', 'Boleto', 'real', ticket), ('B8', 'Boleto', 'arena', ticket),
    ('C1', 'Tendencia', 'tapete', trend), ('C2', 'Tendencia', 'burdeos', trend), ('C3', 'Tendencia', 'amarillo', trend), ('C4', 'Tendencia', 'violeta', trend),
    ('A1', 'Balón', 'naranja', lambda im, p: ball(im, p)), ('A2', 'Balón', 'real', lambda im, p: ball(im, p)), ('A3', 'Balón', 'rojo', lambda im, p: ball(im, p)), ('A4', 'Balón', 'arena', lambda im, p: ball(im, p)),
]


def make(key, pal, fn):
    p = PAL[pal]
    im = tile(p)
    d = ImageDraw.Draw(im)
    frame(d, p)
    fn(im, p)
    return im.resize((512, 512), Image.LANCZOS)


def main(out):
    os.makedirs(out, exist_ok=True)
    tiles = []
    for key, name, pal, fn in DESIGNS:
        im = make(key, pal, fn)
        im.save(os.path.join(out, f'icono-{key}.png'))
        tiles.append((key, name, pal, im))
    cols, cw, ch = 4, 300, 360
    rows_ = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cw, rows_ * ch + 40), (238, 240, 239))
    ds = ImageDraw.Draw(sheet)
    try:
        f1 = ImageFont.truetype('arialbd.ttf', 22); f2 = ImageFont.truetype('arial.ttf', 16)
    except Exception:
        f1 = f2 = ImageFont.load_default()
    for i, (key, name, pal, im) in enumerate(tiles):
        x, y = (i % cols) * cw + 22, (i // cols) * ch + 30
        sheet.paste(im.resize((256, 256), Image.LANCZOS), (x, y), im.resize((256, 256), Image.LANCZOS))
        ds.text((x, y + 266), f'{key} · {name}', fill=(20, 30, 30), font=f1)
        ds.text((x, y + 294), f'colores: {pal}', fill=(90, 100, 100), font=f2)
    sheet.save(os.path.join(out, 'propuestas.png'))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')


def export_app(out, pal='amarillo', fn=None):
    """Iconos finales de la app con el diseño elegido (B4: boleto en amarillo): 512, 192, 180, favicon 64 y maskable."""
    fn = fn or ticket
    p = PAL[pal]
    big = tile(p)
    d = ImageDraw.Draw(big)
    frame(d, p)
    fn(big, p)
    i512 = big.resize((512, 512), Image.LANCZOS)
    i512.save(os.path.join(out, 'icon-512.png'))
    i512.resize((192, 192), Image.LANCZOS).save(os.path.join(out, 'icon-192.png'))
    # 180 para iPhone: sin transparencia (iOS pone su propia máscara)
    flat = tile(p)
    flat_full = Image.new('RGBA', (N, N), flat.getpixel((N // 2, N // 2)))
    full_bg = Image.new('RGBA', (N, N))
    top, bot = p['bg']
    db = ImageDraw.Draw(full_bg)
    for y in range(N):
        t = y / (N - 1)
        db.line([(0, y), (N, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))
    art = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    da = ImageDraw.Draw(art)
    frame(da, p)
    fn(art, p)
    apple = full_bg.copy(); apple.alpha_composite(art)
    apple.convert('RGB').resize((180, 180), Image.LANCZOS).save(os.path.join(out, 'icon-180.png'))
    i512.resize((64, 64), Image.LANCZOS).save(os.path.join(out, 'favicon.png'))
    # adaptable: fondo a sangre y el dibujo al 80 %
    small = art.resize((int(N * .8), int(N * .8)), Image.LANCZOS)
    mk = full_bg.copy(); mk.alpha_composite(small, (int(N * .1), int(N * .1)))
    mk.resize((512, 512), Image.LANCZOS).save(os.path.join(out, 'icon-maskable.png'))
