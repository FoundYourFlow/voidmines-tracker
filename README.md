# VoidMines Shorts Tracker

Live views, likes and creator payout ($2 per 1,000 views) for the Shorts listed in `videos.json`.

- **Site:** https://foundyourflow.github.io/voidmines-tracker/
- **Add a video:** open an issue titled `Add <YouTube link>` (only the repo owner's issues are accepted).
- **Remove a video:** open an issue titled `Remove <YouTube link>`.
- **Change the rate:** edit `ratePer1000` in `videos.json`.

`.github/workflows/update.yml` refreshes counts about once a minute and writes them to `stats.json` on the `data` branch, which the page reads.
