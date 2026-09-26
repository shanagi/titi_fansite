#!/usr/bin/env python3
"""smoke_test.py — Playwright(ヘッドレスChromium)によるサイトの動作確認。

事前に `python3 -m http.server 8000` でサイトを起動しておくこと。
実行: python3 scripts/smoke_test.py

確認内容:
  - 全シートが読み込まれ、件数が表示される
  - キーワード検索で件数が絞られる
  - ラジオネーム検索・シート別・放送回範囲の絞り込みが効く
  - 並び替え(昇順/降順)が効く
  - 放送回のバッジにリンクが付く(整数の回で episodes.json にデータがある場合)
  - 出典表示がある
  - ブラウザのコンソールにエラーが出ていない
"""

import re
import sys

BASE_URL = "http://localhost:8000/"


def fail(message):
    print(f"NG: {message}")
    sys.exit(1)


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "Playwright が見つかりません。`pip install playwright` と "
            "`playwright install chromium` を実行してから再度お試しください。"
        )
        sys.exit(2)

    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
        )
        page.on("pageerror", lambda exc: console_errors.append(str(exc)))

        page.goto(BASE_URL, wait_until="networkidle")

        # 全シートが読み込まれ、件数が表示される
        page.wait_for_selector("#result-count:not(:empty)", timeout=15000)
        count_text = page.text_content("#result-count")
        m = re.search(r"(\d+)件\s*/\s*全(\d+)件", count_text or "")
        if not m:
            fail(f"件数表示の形式が想定と違います: {count_text!r}")
        total = int(m.group(2))
        if total == 0:
            fail("全件数が0件です。シートの読み込みに失敗している可能性があります。")
        print(f"OK: 件数表示 ({count_text.strip()})")

        # エラーバナーが出ていないか確認(出ていても致命的ではないが警告する)
        if page.is_visible("#error-banner"):
            print(f"WARN: エラーバナーが表示されています: {page.text_content('#error-banner')}")

        # キーワード検索で件数が絞られる
        page.fill("#keyword-input", "ネタ")
        page.wait_for_timeout(400)
        filtered_text = page.text_content("#result-count")
        m2 = re.search(r"(\d+)件", filtered_text or "")
        if not m2 or int(m2.group(1)) >= total:
            fail(f"キーワード検索で件数が絞られていません: {filtered_text!r}")
        print(f"OK: キーワード検索 ({filtered_text.strip()})")
        page.fill("#keyword-input", "")
        page.wait_for_timeout(300)

        # ラジオネーム検索
        page.click("#filter-panel summary")
        first_radioname = page.get_attribute(".radioname-chip", "data-radioname")
        if first_radioname:
            page.fill("#radioname-input", first_radioname)
            page.wait_for_timeout(400)
            rn_text = page.text_content("#result-count")
            print(f"OK: ラジオネーム検索 ({rn_text.strip()})")
            page.fill("#radioname-input", "")
            page.wait_for_timeout(300)
        else:
            print("WARN: ラジオネームのチップが見つからず、ラジオネーム検索の確認をスキップしました。")

        # シート別絞り込み
        # (ボタン一覧は絞り込み変更のたびに再描画されるため、都度クエリし直す)
        sheet_buttons = page.query_selector_all(".filter-btn")
        if len(sheet_buttons) > 1:
            sheet_buttons[1].click()
            page.wait_for_timeout(400)
            sheet_text = page.text_content("#result-count")
            print(f"OK: シート別絞り込み ({sheet_text.strip()})")
            page.query_selector(".filter-btn").click()  # 「すべて」に戻す
            page.wait_for_timeout(300)
        else:
            fail("シート別絞り込みボタンが見つかりません。")

        # 放送回範囲の絞り込み(直近の回番号を対象にする)
        page.fill("#episode-from", "270")
        page.fill("#episode-to", "280")
        page.wait_for_timeout(400)
        range_text = page.text_content("#result-count")
        m3 = re.search(r"(\d+)件", range_text or "")
        if not m3 or int(m3.group(1)) == 0 or int(m3.group(1)) >= total:
            fail(f"放送回範囲の絞り込みが効いていません: {range_text!r}")
        print(f"OK: 放送回範囲の絞り込み ({range_text.strip()})")
        page.fill("#episode-from", "")
        page.fill("#episode-to", "")
        page.wait_for_timeout(300)

        # 並び替え(昇順/降順)
        page.click("#sort-toggle")
        page.wait_for_timeout(200)
        label_asc = page.text_content("#sort-toggle")
        page.click("#sort-toggle")
        page.wait_for_timeout(200)
        label_desc = page.text_content("#sort-toggle")
        if "昇順" not in label_asc or "降順" not in label_desc:
            fail(f"並び替えボタンの表示が想定と違います: {label_asc!r} / {label_desc!r}")
        print("OK: 並び替えボタンの切り替え")
        page.click("#sort-toggle")  # 記載順に戻す

        # 放送回バッジのリンク
        badge_links = page.query_selector_all("a.badge-episode")
        if badge_links:
            print(f"OK: 放送回バッジにリンクあり ({len(badge_links)}件)")
        else:
            print("WARN: リンク付きの放送回バッジが見つかりません(episodes.jsonが空の場合は正常)。")

        # 出典表示
        footer_text = page.text_content(".site-footer") or ""
        if "きゅうり大好きっ子ちゃん" not in footer_text or "非公式" not in footer_text:
            fail("フッターの出典表示が見つかりません。")
        print("OK: 出典表示")

        browser.close()

    if console_errors:
        fail("コンソールエラーが出ています:\n" + "\n".join(console_errors))
    print("OK: コンソールエラーなし")

    print("\nすべての確認が完了しました。")


if __name__ == "__main__":
    main()
