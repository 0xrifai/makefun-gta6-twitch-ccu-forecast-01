# Hour-by-hour Twitch viewer forecaster — make.fun gta6-twitch-ccu-forecast-01

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/0xrifai/makefun-gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/0xrifai/makefun-gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

A program that forecasts how many people watch Grand Theft Auto VI live on
Twitch in each hour of its release day, 2026-11-19 (UTC), after the first
hour's count arrives. It reads one case file (`/input/<id>.in`) and writes
one forecast (`/output/<id>.out`): for each of hours 2 to 24, five quantiles
(5%, 25%, 50%, 75%, 95%) of that hour's concurrent viewer count. Entry for
[make.fun's GTA VI Twitch forecast bounty](https://make.fun/bounty/gta6-twitch-ccu-forecast-01).

## How it forecasts

The case file carries `comparables` — 38 to 42 past big game launches, each
with its full release-day hourly Twitch curve. For each forecast hour, the
program takes the 8 comparables whose hour-1 print is closest in log space
to this case's hour-1 print, and forecasts from the median and spread of
their log ratios `log(viewers_h / viewers_1)`:

```
q_tau(h) = p1 * exp(median_h + z_tau * sd_h)
```

Launch-day curves are not flat: hour 1 only sees the regions that already
unlocked, and the audience ramps as the US unlocks — but how much it ramps
depends almost entirely on how big hour 1 already is, and the growth
saturates near a ratio of 1 for the biggest launches. A nearest-neighbour
median in `log(p1)` captures that saturation where a straight regression
does not. When a case's hour-1 print sits beyond the biggest comparable,
the spread widens a little, since that is outside the training data.

Leave-one-out over the 37 complete comparable curves: mean pinball loss
(log scale) about 0.42, against about 0.93 for the house persistence
baseline; on launches with hour-1 prints above 100k, about 0.25 against
the baseline's 0.26. The program is deterministic (same input, same bytes),
runs offline with no network, and finishes in well under a second per case.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is the whole entry (Node 22, standard library only). `LICENSE` is
MIT.
