#!/usr/bin/env python3
"""brainlearn.py — the thinking drivers learn to race, by racing themselves.

The constants a driver is made of (native/src/race.hpp BrainTune) are not picked by
hand here. A population of settings is raced headless (native/build/xbr-race --real),
each one scored on what racing is FOR:

  * a leader-pace car started last has to be able to come through   (XBR_FASTLAST)
  * the field has to pass each other
  * and it must not wreck itself doing it: every retirement costs, more than two costs a lot

The best few settings breed the next population (cross-entropy method). Fresh seeds
every generation, and the champion is re-raced, so nothing wins by being lucky once.

    nice -n 19 python3 tools/brainlearn.py [--gens 9] [--pop 8] [--jobs 2] [--bin PATH]

It writes a log as it goes and prints the winning XBR_BT string at the end.
One race measures nothing: read the per-generation MEANS, not single scores.
"""
import argparse, math, os, random, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# name: (default, low, high)
PARAMS = {
    "lane": (2.7, 2.3, 3.2), "passW": (14, 5, 45), "defW": (14, 5, 45), "riskW": (3.0, 0.4, 9.0),
    "switchC": (1.5, 0.0, 4.0), "simPen": (0.07, 0.02, 0.13), "capPen": (0.10, 0.04, 0.17),
    "hwBase": (4.0, 2.0, 8.0), "hwK": (0.14, 0.05, 0.28), "gate": (2.2, 2.0, 3.3),
    "closeAfter": (12, 6, 25), "lateK": (1.5, 0.4, 3.0), "confRisk": (2.0, 0.4, 6.0), "horizonK": (1.0, 0.6, 1.6),
}
NAMES = list(PARAMS)


def bt(vec):
    return ",".join(f"{n}={v:.4g}" for n, v in zip(NAMES, vec))


def race(binp, vec, track, laps, grid, seed, fastlast):
    env = dict(os.environ, XBR_BT=bt(vec))
    if fastlast:
        env["XBR_FASTLAST"] = "1"
    out = subprocess.run([binp, "--data", os.path.join(ROOT, "data"), "--real", "--seed", str(seed), track, "gt3", str(laps), str(grid), "hard"],
                         env=env, capture_output=True, text=True, timeout=900).stdout
    pos, ret = grid, False
    for line in out.splitlines():
        m = re.match(r"\s*(\d+) .*grid\s+%d\b" % grid, line)
        if m:
            pos, ret = int(m.group(1)), "RETIRED" in line
    fin = re.search(r"retired (\d+)", out)
    pas = re.search(r"passes: (\d+)", out)
    if not fin or not pas:
        return None
    return {"pos": pos, "out": ret, "retired": int(fin.group(1)), "passes": int(pas.group(1))}


def score(r, grid, fastlast):
    if r is None:
        return -20.0
    s = -1.2 * r["retired"] - 2.0 * max(0, r["retired"] - 2)
    if fastlast:
        s += 0.0 if r["out"] else 10.0 * (grid - r["pos"]) / (grid - 1)
        s += 0.03 * min(r["passes"], 80)
    return s


def evaluate(binp, vec, seeds):
    plan = [("monza", 4, 18, seeds[0], True), ("monza", 4, 18, seeds[1], True), ("zandvoort", 4, 18, seeds[2], True), ("monza", 3, 22, seeds[3], False)]
    tot, rows = 0.0, []
    for trk, laps, grid, seed, fl in plan:
        r = race(binp, vec, trk, laps, grid, seed, fl)
        tot += score(r, grid, fl)
        rows.append(r)
    return tot / len(plan), rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gens", type=int, default=9)
    ap.add_argument("--pop", type=int, default=8)
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--bin", default=os.path.join(ROOT, "native", "build", "xbr-race"))
    ap.add_argument("--log", default=os.path.join(ROOT, "native", "check", "brainlearn.log"))
    ap.add_argument("--seed", type=int, default=20261009)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    lo = [PARAMS[n][1] for n in NAMES]
    hi = [PARAMS[n][2] for n in NAMES]
    mean = [PARAMS[n][0] for n in NAMES]
    sig = [(h - l) * 0.22 for l, h in zip(lo, hi)]
    log = open(a.log, "a")

    def say(s):
        print(s, flush=True)
        log.write(s + "\n")
        log.flush()

    say(f"# brainlearn {time.strftime('%Y-%m-%d %H:%M')}  gens {a.gens} pop {a.pop} jobs {a.jobs}")
    champ, champS = list(mean), None
    for g in range(a.gens):
        seeds = [rng.randrange(1, 9000) for _ in range(4)]
        pop = [list(champ)] + [[min(h, max(l, rng.gauss(m, s))) for m, s, l, h in zip(mean, sig, lo, hi)] for _ in range(a.pop - 1)]
        with ThreadPoolExecutor(a.jobs) as ex:
            res = list(ex.map(lambda v: evaluate(a.bin, v, seeds), pop))
        ranked = sorted(zip([r[0] for r in res], pop, [r[1] for r in res]), key=lambda x: -x[0])
        for sc, vec, rows in ranked:
            fl = [r for r in rows[:3] if r]
            say(f"g{g} score {sc:6.2f}  fast car -> {[r['pos'] for r in fl]}  passes {[r['passes'] for r in fl]}  retired {[r['retired'] for r in rows if r]}  {bt(vec)}")
        say(f"g{g} MEAN of population {sum(r[0] for r in res) / len(res):.2f}   the champion re-raced on new seeds: {res[0][0]:.2f}")
        elite = [v for _, v, _ in ranked[:3]]
        mean = [sum(v[k] for v in elite) / len(elite) for k in range(len(NAMES))]
        sig = [max((h - l) * 0.04, 0.85 * math.sqrt(sum((v[k] - mean[k]) ** 2 for v in elite) / len(elite)) + (h - l) * 0.03) for k, (l, h) in enumerate(zip(lo, hi))]
        # the champion only changes for a setting that beat it on the SAME seeds this generation
        if ranked[0][1] != champ:
            champ, champS = list(ranked[0][1]), ranked[0][0]
    say(f"CHAMPION {bt(champ)}")
    say(f"MEAN     {bt(mean)}")


if __name__ == "__main__":
    sys.exit(main())
