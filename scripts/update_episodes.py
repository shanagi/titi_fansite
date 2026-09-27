#!/usr/bin/env python3
"""update_episodes.py — Apple Podcastsのエピソード一覧から data/episodes.json を生成する。

標準ライブラリのみで動作する。
実行: python3 scripts/update_episodes.py

仕様:
  - iTunes Lookup API の trackViewUrl を使う。APIは最新200件までしか返さないため、
    既存の episodes.json に蓄積(マージ)し、一度取れたリンクは範囲外になっても消さない。
  - 紐づけるのは【本編】と【本編＋特別編】のみ。小数の回は紐づけない。
  - 取得件数が前回より大きく減っていたら、上書きせずエラー終了する。
  - 手動補正 data/episode-overrides.json は、サイト側(app.js)が自動紐づけより優先して使う。
"""

import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

SHOW_ID = "1567028358"
LOOKUP_URL = (
    "https://itunes.apple.com/lookup?id=%s&entity=podcastEpisode&limit=200&country=jp" % SHOW_ID
)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EPISODES_PATH = os.path.join(ROOT, "data", "episodes.json")

JST = timezone(timedelta(hours=9))
TITLE_RE = re.compile(r"^\s*◆\s*(\d+(?:\.\d+)?)\s*【(.+?)】")
# 本編として扱う種別(NFKC正規化後に比較する)
HONPEN_KINDS = {"本編", "本編+特別編"}
# 前回の取得件数に対して、この割合を下回ったら異常とみなす
MIN_RATIO = 0.8


def fetch_lookup():
    req = urllib.request.Request(LOOKUP_URL, headers={"User-Agent": "titi-fansite-updater"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def to_jst_date(release_date):
    # 例: 2026-09-26T10:00:00Z
    dt = datetime.strptime(release_date, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return dt.astimezone(JST).strftime("%Y-%m-%d")


def parse_episodes(results):
    """APIの結果から、本編の {回番号(str): {title, date, url}} と取得したエピソード数を返す。"""
    episodes = {}
    fetched = 0
    for item in results:
        if item.get("kind") != "podcast-episode":
            continue
        fetched += 1
        title = item.get("trackName", "")
        m = TITLE_RE.match(title)
        if not m:
            continue
        kind = unicodedata.normalize("NFKC", m.group(2))
        if kind not in HONPEN_KINDS:
            continue
        number = m.group(1)
        if "." in number:  # 小数の回は紐づけない
            continue
        url = item.get("trackViewUrl")
        if not url:
            continue
        key = str(int(number))
        if key in episodes:  # APIは新しい順。重複時は先に出た(新しい)方を残す
            print("WARN: %s回の本編が重複しています。先に出たものを使います: %s" % (key, title))
            continue
        episodes[key] = {
            "title": title,
            "date": to_jst_date(item["releaseDate"]),
            "url": url,
        }
    return episodes, fetched


def load_existing():
    if not os.path.exists(EPISODES_PATH):
        return {}
    with open(EPISODES_PATH, encoding="utf-8") as f:
        return json.load(f)


def main():
    try:
        data = fetch_lookup()
    except (urllib.error.URLError, ValueError, OSError) as e:
        print("ERROR: iTunes Lookup API の取得に失敗しました: %s" % e)
        return 1

    fetched_eps, fetched_count = parse_episodes(data.get("results", []))
    if not fetched_eps:
        print("ERROR: 本編のエピソードを1件も取得できませんでした。既存データは変更しません。")
        return 1

    existing = load_existing()
    prev_count = existing.get("fetched_count")
    if prev_count and fetched_count < prev_count * MIN_RATIO:
        print(
            "ERROR: 取得件数が前回(%d件)より大きく減っています(%d件)。上書きせず終了します。"
            % (prev_count, fetched_count)
        )
        return 1

    # 蓄積: 既存に今回の取得分を上書きマージする(APIの範囲外になった古い回も残す)
    merged = dict(existing.get("episodes", {}))
    merged.update(fetched_eps)

    latest_key = max(fetched_eps, key=lambda k: int(k))
    src = fetched_eps[latest_key]
    latest = {"no": int(latest_key), "title": src["title"], "date": src["date"], "url": src["url"]}

    new_body = {
        "latest": latest,
        "fetched_count": fetched_count,
        "episodes": dict(sorted(merged.items(), key=lambda kv: int(kv[0]), reverse=True)),
    }
    old_body = {
        "latest": existing.get("latest"),
        "fetched_count": existing.get("fetched_count"),
        "episodes": existing.get("episodes"),
    }
    if new_body == old_body:
        print("変更なし(本編 %d件を保持)。episodes.json は更新しません。" % len(merged))
        return 0

    output = {"updated": datetime.now(JST).replace(microsecond=0).isoformat()}
    output.update(new_body)
    with open(EPISODES_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        f.write("\n")

    added = len(set(merged) - set(existing.get("episodes", {})))
    print(
        "更新しました: 取得 %d件 / 本編 %d件を保持(新規 %d件) / 最新 %d回"
        % (fetched_count, len(merged), added, latest["no"])
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
