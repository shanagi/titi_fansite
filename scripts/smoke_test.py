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
        if not page.query_selector('.intro a[href="https://x.com/pomp364"]'):
            fail("冒頭の「きゅうり大好きっ子ちゃん」がリンク(https://x.com/pomp364)になっていません。")
        print("OK: 冒頭の説明(提供元はリンク)")

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
            y_header = page.eval_on_selector(".results-header", "e => e.getBoundingClientRect().top")
            if not y_banner < y_header:
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

        # 最新回の投稿は、初期表示では折りたたまれていて、見出しの行をタップすると開閉する
        def top_state():
            return page.evaluate(
                """() => ({
                  expanded: document.querySelector('.results-header').getAttribute('aria-expanded'),
                  listVisible: !document.getElementById('results-list').hidden,
                  cardVisible: !!document.querySelector('.result-card') && document.querySelector('.result-card').offsetParent !== null,
                })"""
            )

        s0 = top_state()
        if s0["expanded"] != "false" or s0["listVisible"] or s0["cardVisible"]:
            fail(f"トップの最新回の投稿が、初期表示で折りたたまれていません: {s0}")
        page.click(".results-header")
        page.wait_for_timeout(200)
        s1 = top_state()
        if s1["expanded"] != "true" or not s1["listVisible"] or not s1["cardVisible"]:
            fail(f"見出しの行をタップしても、最新回の投稿が開きません: {s1}")
        page.click(".results-header")
        page.wait_for_timeout(200)
        s2 = top_state()
        if s2["expanded"] != "false" or s2["listVisible"]:
            fail(f"もう一度タップしても、最新回の投稿が閉じません: {s2}")
        # キーボード(Enter)でも開閉できる
        page.focus(".results-header")
        page.keyboard.press("Enter")
        page.wait_for_timeout(200)
        if not top_state()["listVisible"]:
            fail("Enterキーで、最新回の投稿を開けません。")
        page.keyboard.press("Space")
        page.wait_for_timeout(200)
        if top_state()["listVisible"]:
            fail("Spaceキーで、最新回の投稿を閉じられません。")
        print("OK: 最新回の投稿は折りたたみ(初期は閉じ、タップ・Enter・Spaceで開閉)")

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
        expected_order = [
            "すべて", "ともはるさ～ん", "リスナージングル", "ラジ父大喜利", "ワーキャー", "俺にもありました",
            "優しいゴージャスさん", "パンダマン", "韻豆", "ガクにもわかりますか？", "エンディングのコーナー", "その他",
        ]
        actual_order = [b.text_content().strip() for b in sheet_buttons]
        if actual_order != expected_order:
            fail(f"シート別ボタンの並びが仕様と違います:\n  実際: {actual_order}\n  仕様: {expected_order}")
        print("OK: シート別ボタンの並び順")
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

        # 投稿の表示順(記載順)も、絞り込みボタンと同じシートの並び(放送回で固まっているので、ラジ父大喜利→エンディングのコーナーの順)
        page.fill("#episode-from", "279")
        page.fill("#episode-to", "279")
        page.wait_for_timeout(500)
        sheet_seq = page.eval_on_selector_all(".result-card .sheet-chip", "els => els.map(e => e.textContent.trim())")
        order_idx = {n: i for i, n in enumerate(expected_order[1:])}
        idx = [order_idx[n] for n in sheet_seq]
        if idx != sorted(idx):
            fail(f"投稿の記載順が、絞り込みボタンのシートの並びと違います: {sheet_seq}")
        print(f"OK: 投稿の表示順がボタンの並びと一致 (279回の {len(sheet_seq)} 件)")
        page.fill("#episode-from", "")
        page.fill("#episode-to", "")
        page.wait_for_timeout(300)

        # リセットボタン: トップでは出ず、検索・絞り込み中だけ出る。押すとすべて初期状態に戻る
        if page.is_visible("#reset-all"):
            fail("検索していないのに、リセットボタンが表示されています。")
        page.fill("#keyword-input", "ネタ")
        page.fill("#radioname-input", "あ")
        page.fill("#episode-from", "270")
        page.query_selector_all(".filter-btn")[2].click()  # 「すべて」以外のシートを選ぶ
        page.click("#sort-toggle")
        page.wait_for_timeout(500)
        if not page.is_visible("#reset-all"):
            fail("検索・絞り込み中なのに、リセットボタンが表示されていません。")
        page.click("#reset-all")
        page.wait_for_timeout(400)
        state = page.evaluate(
            """() => ({
              inputs: ['keyword-input', 'radioname-input', 'episode-from', 'episode-to'].map(id => document.getElementById(id).value),
              active: document.querySelector('.filter-btn.is-active').textContent.trim(),
              sort: document.getElementById('sort-toggle').textContent.trim(),
              count: document.getElementById('result-count').textContent.trim(),
              reset: !document.getElementById('reset-all').hidden,
            })"""
        )
        if any(state["inputs"]) or state["active"] != "すべて" or "記載順" not in state["sort"] or "回の投稿" not in state["count"] or state["reset"]:
            fail(f"リセット後に初期状態へ戻っていません: {state}")
        print("OK: リセットボタン(全条件を解除してトップに戻る)")

        # タイトルをタップすると最初の画面に戻る
        page.click("#filter-panel summary") if not page.evaluate("document.getElementById('filter-panel').open") else None
        page.fill("#keyword-input", "川北")
        page.query_selector_all(".filter-btn")[3].click()
        page.wait_for_timeout(400)
        page.fill("#keyword-input", "")
        page.wait_for_timeout(400)
        page.click(".results-header")  # トップの最新回の投稿を開いておく(タイトルのタップで閉じに戻ることを確認する)
        page.query_selector_all(".filter-btn")[3].click()
        page.wait_for_timeout(300)
        page.evaluate("window.scrollTo(0, 600)")
        page.click("#site-title-link")
        page.wait_for_timeout(400)
        back = page.evaluate(
            """() => ({
              keyword: document.getElementById('keyword-input').value,
              active: document.querySelector('.filter-btn.is-active').textContent.trim(),
              open: document.getElementById('filter-panel').open,
              y: Math.round(window.scrollY),
              count: document.getElementById('result-count').textContent.trim(),
              url: location.pathname,
            })"""
        )
        back["collapsed"] = page.evaluate("document.getElementById('results-list').hidden")
        if back["keyword"] or back["active"] != "すべて" or back["open"] or back["y"] != 0 or "回の投稿" not in back["count"] or not back["collapsed"]:
            fail(f"タイトルをタップしても最初の画面に戻りません: {back}")
        print("OK: タイトルのタップで最初の画面に戻る")

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
