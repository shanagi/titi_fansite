#!/usr/bin/env python3
"""smoke_test.py — Playwright(ヘッドレスChromium)によるサイトの動作確認。

事前に `python3 -m http.server 8000` でサイトを起動しておくこと。
実行: python3 scripts/smoke_test.py

確認内容:
  - トップは「検索窓 → 最新回のバナー → 最新回の投稿」の順で、検索結果は検索したときだけ出る
  - 冒頭の非公式ファンサイトの説明、一番下のクレジット
  - 全シートが読み込まれ、件数が表示される
  - キーワード検索で件数が絞られ、消すとトップに戻る
  - ラジオネーム検索・シート別・放送回範囲の絞り込みが効く
  - 並び替え(昇順/降順)が効く
  - 放送回のバッジにリンクが付く(整数の回で episodes.json にデータがある場合)
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

        # ---- トップページ(検索していない状態) ----
        # 読み込み完了(「読み込み中…」が消える)を待つ
        page.wait_for_function(
            "() => { const t = document.getElementById('result-count').textContent;"
            " return t && !t.includes('読み込み中'); }",
            timeout=30000,
        )
        top_text = (page.text_content("#result-count") or "").strip()
        print(f"OK: トップの表示 ({top_text})")

        # 冒頭に非公式である旨の説明がある
        intro_text = page.text_content(".intro") or ""
        if "非公式" not in intro_text or "関係ありません" not in intro_text:
            fail("冒頭の非公式ファンサイトの説明が見つかりません。")
        print("OK: 冒頭の説明")

        # デザイン: タイトルは黒、「父」だけ赤 / 背景は格子 / フォント
        title_colors = page.evaluate(
            """() => {
              const h = document.querySelector('h1.site-title');
              const r = h.querySelector('.title-red');
              return { h1: getComputedStyle(h).color, red: getComputedStyle(r).color, redText: r.textContent };
            }"""
        )
        if title_colors["h1"] != "rgb(0, 0, 0)" or title_colors["red"] != "rgb(220, 0, 0)" or title_colors["redText"] != "父":
            fail(f"タイトルの色が仕様(黒、「父」のみ赤 #DC0000)と違います: {title_colors}")
        # 背景の柄はページ全体に敷き、カラム(.page)の中は無地(柄を入れない)。両側に襟の帯がある
        bg = page.evaluate(
            """() => {
              const body = getComputedStyle(document.body);
              const page = document.querySelector('.page');
              const ps = getComputedStyle(page);
              return { bodyImage: body.backgroundImage, pageImage: ps.backgroundImage,
                       left: ps.borderLeftWidth, right: ps.borderRightWidth,
                       leftColor: ps.borderLeftColor,
                       inside: ['.search-bar', 'main', '.site-footer'].every(s => page.contains(document.querySelector(s))) };
            }"""
        )
        if "url(" not in bg["bodyImage"]:
            fail(f"背景の柄が設定されていません: {bg['bodyImage'][:80]!r}")
        if bg["pageImage"] != "none":
            fail(f"カラムの中に柄が入っています(無地にする): {bg['pageImage'][:80]!r}")
        if bg["left"] == "0px" or bg["right"] == "0px" or bg["leftColor"] == "rgba(0, 0, 0, 0)":
            fail(f"カラムの両側に襟の帯がありません: {bg}")
        if not bg["inside"]:
            fail("検索欄・結果・フッターが、無地のカラムの外に出ています。")
        print("OK: タイトルの色 / 柄の背景・無地のカラム・襟の帯")
        fonts_ok = page.evaluate(
            """async () => {
              await document.fonts.ready;
              return [document.fonts.check('700 16px "Zen Maru Gothic"'),
                      document.fonts.check('400 16px "Zen Kaku Gothic New"')];
            }"""
        )
        if all(fonts_ok):
            print("OK: Webフォント (Zen Maru Gothic / Zen Kaku Gothic New)")
        else:
            print(f"WARN: Webフォントが読み込めていません(オフライン環境では標準フォントで表示されます): {fonts_ok}")

        # 表示順: 検索窓 → 最新回のバナー → 最新回の投稿
        banner_visible = page.is_visible("#latest-episode")
        if banner_visible:
            if not page.query_selector("#latest-episode a.latest-btn"):
                fail("最新回バナーにApple Podcastsへのリンクがありません。")
            y_search = page.eval_on_selector(".search-bar", "e => e.getBoundingClientRect().top")
            y_banner = page.eval_on_selector("#latest-episode", "e => e.getBoundingClientRect().top")
            if not y_search < y_banner:
                fail("表示順が「検索窓 → 最新回のバナー」になっていません。")
            first_card = page.query_selector(".result-card")
            if first_card:
                y_card = page.eval_on_selector(".result-card", "e => e.getBoundingClientRect().top")
                if not y_banner < y_card:
                    fail("表示順が「最新回のバナー → 最新回の投稿」になっていません。")
            print("OK: 表示順 (検索窓 → 最新回のバナー → 最新回の投稿)")
        else:
            print("WARN: 最新回バナーが表示されていません(episodes.jsonのlatestが空の場合は正常)。")

        # 検索していないときは、最新回の投稿だけが出る
        if "回の投稿" not in top_text:
            fail(f"トップに最新回の投稿の表示がありません: {top_text!r}")
        episode_labels = set(
            page.eval_on_selector_all(".result-card .badge-episode", "els => els.map(e => e.textContent.trim())")
        )
        if len(episode_labels) > 1:
            fail(f"トップに複数の回の投稿が出ています(検索結果が出ている): {episode_labels}")
        if page.is_visible("#sort-toggle"):
            fail("検索していないのに、並び替えボタンが表示されています。")
        print(f"OK: トップは最新回の投稿のみ ({', '.join(episode_labels) or '投稿なし'})")

        # エラーバナーが出ていないか確認(出ていても致命的ではないが警告する)
        if page.is_visible("#error-banner"):
            print(f"WARN: エラーバナーが表示されています: {page.text_content('#error-banner')}")

        # ---- 検索 ----
        # キーワード検索(検索結果が出て、全件数が分かる)
        page.fill("#keyword-input", "ネタ")
        page.wait_for_timeout(400)
        filtered_text = (page.text_content("#result-count") or "").strip()
        m = re.search(r"(\d+)件\s*/\s*全(\d+)件", filtered_text)
        if not m:
            fail(f"検索結果の件数表示の形式が想定と違います: {filtered_text!r}")
        hits, total = int(m.group(1)), int(m.group(2))
        if total == 0:
            fail("全件数が0件です。シートの読み込みに失敗している可能性があります。")
        if hits == 0 or hits >= total:
            fail(f"キーワード検索で件数が絞られていません: {filtered_text!r}")
        print(f"OK: 全シート読み込み・キーワード検索 ({filtered_text})")
        first_radioname = page.get_attribute(".radioname-chip", "data-radioname")
        if banner_visible and page.is_visible("#latest-episode"):
            fail("検索中も最新回バナーが表示されています。")

        # 検索を消すとトップに戻る
        page.fill("#keyword-input", "")
        page.wait_for_timeout(400)
        if "回の投稿" not in (page.text_content("#result-count") or ""):
            fail("検索を消してもトップ(最新回の投稿)に戻りません。")
        if banner_visible and not page.is_visible("#latest-episode"):
            fail("検索を消しても最新回バナーが戻りません。")
        print("OK: 検索を消すとトップに戻る")

        # ラジオネーム検索
        page.click("#filter-panel summary")
        if first_radioname:
            page.fill("#radioname-input", first_radioname)
            page.wait_for_timeout(400)
            rn_text = (page.text_content("#result-count") or "").strip()
            print(f"OK: ラジオネーム検索 ({rn_text})")
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
            sheet_text = (page.text_content("#result-count") or "").strip()
            if "全" not in sheet_text:
                fail(f"シート別絞り込みで検索結果が表示されていません: {sheet_text!r}")
            print(f"OK: シート別絞り込み ({sheet_text})")
            page.query_selector(".filter-btn").click()  # 「すべて」に戻す
            page.wait_for_timeout(300)
        else:
            fail("シート別絞り込みボタンが見つかりません。")

        # 放送回範囲の絞り込み(直近の回番号を対象にする)
        page.fill("#episode-from", "270")
        page.fill("#episode-to", "280")
        page.wait_for_timeout(400)
        range_text = (page.text_content("#result-count") or "").strip()
        m3 = re.search(r"(\d+)件", range_text)
        if not m3 or int(m3.group(1)) == 0 or int(m3.group(1)) >= total:
            fail(f"放送回範囲の絞り込みが効いていません: {range_text!r}")
        print(f"OK: 放送回範囲の絞り込み ({range_text})")

        # 並び替え(昇順/降順): 検索中のみ表示される。範囲絞り込みを維持したまま確認する
        page.click("#sort-toggle")
        page.wait_for_timeout(200)
        label_asc = page.text_content("#sort-toggle")
        first_asc = page.eval_on_selector(".result-card .badge-episode", "e => e.textContent.trim()")
        page.click("#sort-toggle")
        page.wait_for_timeout(200)
        label_desc = page.text_content("#sort-toggle")
        first_desc = page.eval_on_selector(".result-card .badge-episode", "e => e.textContent.trim()")
        if "昇順" not in label_asc or "降順" not in label_desc:
            fail(f"並び替えボタンの表示が想定と違います: {label_asc!r} / {label_desc!r}")
        if int(first_asc.rstrip("回")) >= int(first_desc.rstrip("回")):
            fail(f"並び替えが効いていません: 昇順の先頭={first_asc} / 降順の先頭={first_desc}")
        print(f"OK: 並び替え (昇順の先頭 {first_asc} / 降順の先頭 {first_desc})")
        page.click("#sort-toggle")  # 記載順に戻す
        page.fill("#episode-from", "")
        page.fill("#episode-to", "")
        page.wait_for_timeout(300)

        # 放送回バッジのリンク
        badge_links = page.query_selector_all("a.badge-episode")
        if badge_links:
            print(f"OK: 放送回バッジにリンクあり ({len(badge_links)}件)")
        else:
            print("WARN: リンク付きの放送回バッジが見つかりません(episodes.jsonが空の場合は正常)。")

        # ---- フッター(一番下にクレジット) ----
        footer_ps = page.eval_on_selector_all(".site-footer p", "els => els.map(e => e.textContent.trim())")
        footer_text = " ".join(footer_ps).replace("\u2060", "")  # 改行位置の制御用の文字は除く
        if "データ提供：きゅうり大好きっ子ちゃん(@pomp364)様" not in footer_text:
            fail("フッターに「データ提供：きゅうり大好きっ子ちゃん(@pomp364)様」がありません。")
        if "非公式" not in footer_text:
            fail("フッターに非公式ファンサイトの表記がありません。")
        if not footer_ps or "サイト作成：shanagi(@shanagi314)" not in footer_ps[-1]:
            fail("フッターの一番下に「サイト作成：shanagi(@shanagi314)」がありません。")
        if not page.query_selector('.site-footer a[href*="docs.google.com/spreadsheets"]'):
            fail("フッターに元スプレッドシートへのリンクがありません。")
        print("OK: フッターのクレジット")

        browser.close()

    if console_errors:
        fail("コンソールエラーが出ています:\n" + "\n".join(console_errors))
    print("OK: コンソールエラーなし")

    print("\nすべての確認が完了しました。")


if __name__ == "__main__":
    main()
