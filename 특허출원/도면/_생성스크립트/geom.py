"""도면 생성용 기하 계산 모듈.
절두이십면체(truncated icosahedron) 이음선을 구면에 투영하여
정투상(orthographic) 선화 경로를 생성한다."""
import math

PHI = (1 + 5 ** 0.5) / 2


def _cyc(t):
    x, y, z = t
    return [(x, y, z), (y, z, x), (z, x, y)]


def truncated_icosahedron():
    """60개 정점과 90개 모서리를 반환한다."""
    seeds = [(0, 1, 3 * PHI), (1, 2 + PHI, 2 * PHI), (PHI, 2, 2 * PHI + 1)]
    verts = set()
    for sx in (1, -1):
        for sy in (1, -1):
            for sz in (1, -1):
                for a, b, c in seeds:
                    for p in _cyc((sx * a, sy * b, sz * c)):
                        verts.add(tuple(round(v, 9) for v in p))
    verts = sorted(verts)
    # 최소 거리 = 모서리 길이
    dmin = min(
        _dist(verts[0], v) for v in verts[1:]
    )
    edges = []
    n = len(verts)
    for i in range(n):
        for j in range(i + 1, n):
            if abs(_dist(verts[i], verts[j]) - dmin) < 1e-6:
                edges.append((i, j))
    return verts, edges


def _dist(a, b):
    return math.dist(a, b)


def _norm(v):
    m = math.sqrt(sum(c * c for c in v))
    return tuple(c / m for c in v)


def _rot(v, rx, ry, rz):
    x, y, z = v
    cx, sx = math.cos(rx), math.sin(rx)
    y, z = y * cx - z * sx, y * sx + z * cx
    cy, sy = math.cos(ry), math.sin(ry)
    x, z = x * cy + z * sy, -x * sy + z * cy
    cz, sz = math.cos(rz), math.sin(rz)
    x, y = x * cz - y * sz, x * sz + y * cz
    return (x, y, z)


def _slerp(a, b, t):
    d = max(-1.0, min(1.0, sum(p * q for p, q in zip(a, b))))
    th = math.acos(d)
    if th < 1e-9:
        return a
    s = math.sin(th)
    w1, w2 = math.sin((1 - t) * th) / s, math.sin(t * th) / s
    return _norm(tuple(w1 * p + w2 * q for p, q in zip(a, b)))


def ball_paths(cx, cy, r, rx=0.30, ry=0.42, rz=0.10, steps=14, zmin=0.06):
    """전면(z>zmin) 이음선만 곡선 폴리라인 경로 문자열 리스트로 반환."""
    verts, edges = truncated_icosahedron()
    sph = [_rot(_norm(v), rx, ry, rz) for v in verts]
    out = []
    for i, j in edges:
        a, b = sph[i], sph[j]
        run = []
        for k in range(steps + 1):
            p = _slerp(a, b, k / steps)
            if p[2] > zmin:
                run.append((cx + p[0] * r, cy - p[1] * r))
            else:
                if len(run) > 1:
                    out.append(run)
                run = []
        if len(run) > 1:
            out.append(run)
    return ["M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in run) for run in out]


def face_centers(cx, cy, r, rx=0.30, ry=0.42, rz=0.10, zmin=0.35):
    """전면을 향한 면(셀)의 중심 투영 좌표. 셀 부호 지시선용."""
    verts, edges = truncated_icosahedron()
    sph = [_rot(_norm(v), rx, ry, rz) for v in verts]
    adj = {}
    for i, j in edges:
        adj.setdefault(i, set()).add(j)
        adj.setdefault(j, set()).add(i)
    seen, cents = set(), []
    for i in range(len(sph)):
        for j in adj[i]:
            for size in (5, 6):
                cyc = _walk(i, j, adj, sph, size)
                if cyc:
                    key = tuple(sorted(cyc))
                    if key in seen:
                        continue
                    seen.add(key)
                    c = _norm(tuple(sum(sph[k][d] for k in cyc) / size for d in range(3)))
                    if c[2] > zmin:
                        cents.append((cx + c[0] * r, cy - c[1] * r, size))
    return cents


def _walk(start, nxt, adj, sph, size):
    """평면성 검사로 size각형 면을 추적한다."""
    cyc = [start, nxt]
    while len(cyc) < size:
        prev, cur = cyc[-2], cyc[-1]
        best, bestd = None, -2
        for cand in adj[cur]:
            if cand == prev:
                continue
            trial = cyc + [cand]
            if len(trial) > 3 and not _coplanar([sph[k] for k in trial]):
                continue
            d = sum(sph[cand][t] * sph[start][t] for t in range(3))
            if d > bestd:
                best, bestd = cand, d
        if best is None:
            return None
        cyc.append(best)
    return cyc if start in adj[cyc[-1]] else None


def _coplanar(pts, tol=1e-6):
    o = pts[0]
    u = [pts[1][k] - o[k] for k in range(3)]
    v = [pts[2][k] - o[k] for k in range(3)]
    n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    for p in pts[3:]:
        w = [p[k] - o[k] for k in range(3)]
        if abs(sum(n[k] * w[k] for k in range(3))) > tol:
            return False
    return True
