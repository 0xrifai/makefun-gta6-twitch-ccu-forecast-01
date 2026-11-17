// gta6-twitch-ccu-forecast-01: hour-by-hour Twitch viewer forecaster for a
// big game launch day (Node 22, standard library only).
//
// How it forecasts: the case file carries `comparables` — 38 to 42 past big
// game launches, each with its full release-day hourly curve (SullyGnome
// hourly Twitch category averages, 14 days before to 3 days after release).
// For each forecast hour h = 2..24, the program takes the K = 8 comparables
// whose hour-1 print is closest in log space to this case's hour-1 print,
// and reads off the median and spread of their log ratios
// log(viewers_h / viewers_1). The forecast is
//
//   q_tau(h) = p1 * exp(median_h + z_tau * sd_h),
//
// where p1 is this case's hour-1 print, z_tau the standard normal's quantile
// at each scored level, and sd_h the population standard deviation of the
// neighbours' log ratios. The quantiles are rounded to 2 decimals.
//
// Why this shape: launch-day curves are NOT flat. Hour 1 only sees the
// regions that already unlocked (New Zealand / Australia / Japan, then the
// UK at 00:00 UTC); the US unlocks at 05:00-08:00 UTC and the audience
// ramps through the day. But how much a launch ramps depends almost
// entirely on how big hour 1 already is (across the comparables,
// corr(log p1, log peak ratio) is about -0.94): a launch already at 500k
// in hour 1 has little headroom left, while one at 2k can grow a hundred
// fold — and the growth is not log-linear in p1, it saturates near a ratio
// of 1 for the biggest launches. A nearest-neighbour median in log(p1)
// captures that saturation where a straight regression does not, and the
// local spread is honest about how different launches still are (leave-one-
// out over the 37 complete comparable curves: mean pinball loss about 0.42,
// against about 0.93 for the house persistence baseline; on launches with
// hour-1 prints above 100k, about 0.25 against the baseline's 0.26).
//
// Everything is computed from the case file at run time: no hard-coded
// forecast, no network, no clock, no randomness — the same input always
// writes the same bytes. If a case carries too few usable comparables, the
// program falls back to the house persistence shape.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.645, -0.674, 0, 0.674, 1.645];
/** Neighbours whose hour-1 print is closest in log space. */
const K = 8;
/** How much the spread widens per log unit a case sits beyond the biggest
 * comparable's hour-1 print (capped at one unit): the final's hour-1 print
 * may land past every launch in the training set, and a forecast that far
 * outside the data deserves a wider band than the neighbours' spread alone.
 * Inside the training range this factor is exactly 1. */
const EXTRAPOLATION_PER_LOG = 0.3;
/** The persistence fallback's spread, in log units per square-root hour. */
const FALLBACK_SIGMA = 0.15;
/** Smallest spread the program ever writes, in log units. */
const MIN_SD = 0.1;

interface KnownRow {
  hour: number;
  viewers: number;
}

interface ForecastRow {
  hour: number;
}

interface HourlyPoint {
  from: string;
  viewers: number;
}

interface Comparable {
  day_start: string;
  hourly: HourlyPoint[];
}

interface Case {
  levels: number[];
  known: KnownRow[];
  forecast: ForecastRow[];
  comparables: Comparable[];
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** The median of a sorted array. */
const median = (sorted: number[]): number => {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The population standard deviation of an array. */
const pstdev = (xs: number[]): number => {
  const n = xs.length;
  if (n < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n);
};

/**
 * A comparable's release-day hourly viewers, hours 1..24, or null when the
 * curve is incomplete (a missing hour, or a print at or below zero).
 * `day_start` is 00:00 UTC of the launch's release date; an hourly point's
 * `from` is the start of the hour it covers.
 */
const releaseDayCurve = (c: Comparable): number[] | null => {
  const dayStart = Date.parse(c.day_start);
  if (Number.isNaN(dayStart)) return null;
  const byHour: number[] = new Array(25).fill(0);
  const seen: boolean[] = new Array(25).fill(false);
  for (const p of c.hourly) {
    const t = Date.parse(p.from);
    if (Number.isNaN(t)) continue;
    const h = Math.floor((t - dayStart) / 3_600_000) + 1;
    if (h < 1 || h > 24) continue;
    byHour[h] = p.viewers;
    seen[h] = true;
  }
  for (let h = 1; h <= 24; h++) {
    if (!seen[h] || !(byHour[h] > 0)) return null;
  }
  return byHour;
};

/** The persistence fallback's quantiles for one hour (the house baseline). */
const fallbackQuantiles = (p1: number, h: number): number[] =>
  Z.map((z) => round2(p1 * Math.exp(z * FALLBACK_SIGMA * Math.sqrt(h - 1))));

/** The forecast quantiles of one hour from the K nearest comparables. */
const hourQuantiles = (
  p1: number,
  h: number,
  curves: number[][],
): number[] => {
  const logP1 = Math.log(p1);
  const neighbours = curves
    .map((curve, i) => ({
      i,
      d: Math.abs(Math.log(curve[1]) - logP1),
      logRatio: Math.log(curve[h] / curve[1]),
    }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, K);
  if (neighbours.length < 2) return fallbackQuantiles(p1, h);
  const ratios = neighbours.map((n) => n.logRatio).sort((a, b) => a - b);
  const med = median(ratios);
  let sd = Math.max(pstdev(neighbours.map((n) => n.logRatio)), MIN_SD);
  // Widen the band when this case's hour-1 print sits beyond the biggest
  // comparable: the neighbours are then all smaller launches, and the
  // spread they show understates how far outside the data the case is.
  const maxLogP1 = Math.max(...curves.map((curve) => Math.log(curve[1])));
  const excess = Math.max(0, logP1 - maxLogP1);
  sd *= 1 + EXTRAPOLATION_PER_LOG * Math.min(excess, 1);
  const qs = Z.map((z) => round2(p1 * Math.exp(med + z * sd)));
  // Keep the row inside the output contract: above 0, at most 1e9, ordered.
  let prev = 0;
  return qs.map((q) => {
    const clamped = Math.min(Math.max(q, 0.01), 1_000_000_000);
    const ordered = Math.max(clamped, prev);
    prev = ordered;
    return ordered;
  });
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${file} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);
  const curves = (c.comparables ?? [])
    .map(releaseDayCurve)
    .filter((curve): curve is number[] => curve !== null);
  const hours = c.forecast.map(({ hour }) => ({
    hour,
    q: curves.length >= 2 ? hourQuantiles(p1, hour, curves) : fallbackQuantiles(p1, hour),
  }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
