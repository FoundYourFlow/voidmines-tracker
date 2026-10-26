// Fetches current views/likes for every video in videos.json and merges them
// into stats.json, keeping a thinned history of snapshots for the charts.
// Usage: node scripts/update.mjs <videos.json> <stats.json>
import { readFileSync, writeFileSync } from "node:fs";

const [videosPath, statsPath] = process.argv.slice(2);
const config = JSON.parse(readFileSync(videosPath, "utf8"));
let stats = {};
try { stats = JSON.parse(readFileSync(statsPath, "utf8")); } catch {}
const prevById = Object.fromEntries((stats.videos || []).map(v => [v.id, v]));

const SNAPSHOT_EVERY_SEC = 5 * 60;
const MAX_POINTS = 2000;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const num = s => (s == null ? null : Number(String(s).replace(/[^0-9]/g, "")) || 0);
const pick = (html, re) => { const m = html.match(re); return m ? m[1] : null; };
const unescape = s => s && JSON.parse(`"${s}"`);

async function fromWatchPage(id) {
  const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en&gl=US`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: "CONSENT=YES+1; SOCS=CAI" },
  });
  const html = await res.text();
  const views = num(pick(html, /"viewCount":"(\d+)"/));
  if (views == null) throw new Error(`no viewCount on watch page (HTTP ${res.status})`);
  return {
    views,
    likes: num(pick(html, /"likeCount":"(\d+)"/) ?? pick(html, /"likeCountIfIndifferentNumber":"(\d+)"/)),
    title: unescape(pick(html, /"videoDetails":\{[^}]*?"title":"((?:[^"\\]|\\.)*)"/)),
    channel: unescape(pick(html, /"ownerChannelName":"((?:[^"\\]|\\.)*)"/)),
    publishedAt: pick(html, /"publishDate":"([^"]+)"/),
    lengthSeconds: num(pick(html, /"lengthSeconds":"(\d+)"/)),
    source: "youtube",
  };
}

// Fallback when YouTube blocks the runner: Return YouTube Dislike's public API
// (lags YouTube by a few minutes) plus oEmbed for the title.
async function fromFallback(id) {
  const r = await (await fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${id}`)).json();
  let meta = {};
  try { meta = await (await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`)).json(); } catch {}
  return { views: r.viewCount, likes: r.likes, title: meta.title, channel: meta.author_name, source: "ryd" };
}

function thin(history) {
  if (history.length <= MAX_POINTS) return history;
  const half = Math.floor(history.length / 2);
  return history.slice(0, half).filter((_, i) => i % 2 === 0).concat(history.slice(half));
}

const now = Math.floor(Date.now() / 1000);
const out = [];
for (const { id, addedAt } of config.videos) {
  const prev = prevById[id] || { id, history: [] };
  let fresh = null, error = null;
  try { fresh = await fromWatchPage(id); }
  catch (e) {
    error = e.message;
    try { fresh = await fromFallback(id); } catch (e2) { error += `; fallback: ${e2.message}`; }
  }
  const v = { ...prev, id, addedAt };
  if (fresh) {
    for (const k of ["title", "channel", "publishedAt", "lengthSeconds"]) if (fresh[k]) v[k] = fresh[k];
    // The fallback API lags, so never let it pull counts backwards.
    const lagging = fresh.source !== "youtube";
    v.views = lagging ? Math.max(fresh.views ?? 0, prev.views ?? 0) : fresh.views;
    v.likes = lagging ? Math.max(fresh.likes ?? 0, prev.likes ?? 0) : (fresh.likes ?? prev.likes ?? 0);
    v.source = fresh.source;
    v.checkedAt = now;
    const last = v.history.at(-1);
    if (!last || now - last[0] >= SNAPSHOT_EVERY_SEC) v.history = thin([...v.history, [now, v.views, v.likes]]);
    else v.history = [...v.history.slice(0, -1), [last[0], v.views, v.likes]];
  }
  v.error = fresh ? (fresh.source === "youtube" ? null : error) : error;
  out.push(v);
  console.log(`${id}: ${v.views} views, ${v.likes} likes via ${fresh?.source ?? "none"}${error ? ` (${error})` : ""}`);
}

writeFileSync(statsPath, JSON.stringify({ updatedAt: now, ratePer1000: config.ratePer1000, videos: out }) + "\n");
