// app.js — データ取得・検索・絞り込み・並び替え・描画
// シート固有の表示ルールは config.js に定義する。ここではシート名を直書きしない。

(function () {
  'use strict';

  const PAGE_SIZE = 50;

  const state = {
    keyword: '',
    radioQuery: '',
    radioExact: null,
    activeSheet: 'ALL',
    subFilter: null, // { key, value } … 現在の activeSheet の追加の絞り込み(シートを切り替えると null に戻る)
    cornerKey: null, // CONFIG.cornerGroups の key、または '__other__'。activeSheet が cornerGroups.sheetName のときだけ意味を持つ
    otherThemeValue: null, // cornerKey が '__other__' のとき、さらにテーマの値で絞り込む(null = その他全て)
    epFrom: null,
    epTo: null,
    sortMode: 'original', // 'original' | 'asc' | 'desc'
    visibleCount: PAGE_SIZE,
    topOpen: false, // トップ(最新回の投稿)の一覧を開いているか。初期は折りたたむ
    randomPickRecord: null, // トップの「ランダム表示」で選ばれている投稿。null = まだ選んでいない(説明文を表示)
  };

  let allRecords = [];
  let episodesData = { episodes: {}, latest: null };
  let episodeOverrides = {};
  let latestBannerReady = false; // episodes.json に最新回があり、バナーを作れたか
  const loadErrors = []; // { sheetName, message }

  // ---------- ユーティリティ ----------

  function normalizeText(s) {
    return (s == null ? '' : String(s)).normalize('NFKC').toLowerCase().trim();
  }

  function escapeHtml(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function debounce(fn, wait) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // 放送回の文字列を数値化する。数値として解釈できない場合は null。
  function parseEpisodeNumeric(raw) {
    const norm = normalizeText(raw);
    if (norm === '') return null;
    const num = parseFloat(norm);
    return Number.isFinite(num) ? num : null;
  }

  // ---------- データ取得 ----------

  // [[見出し...], [値...], ...] を [{見出し: 値, ...}, ...] に変換する
  function rowsToObjects(matrix) {
    if (!matrix.length) return [];
    const headers = matrix[0].map((h) => (h == null ? '' : String(h).trim()));
    return matrix.slice(1).map((cells) => {
      const obj = {};
      headers.forEach((h, i) => {
        if (h) obj[h] = cells[i] == null ? '' : cells[i];
      });
      return obj;
    });
  }

  function loadSheet(sheetConfig) {
    return new Promise((resolve) => {
      Papa.parse(CONFIG.csvUrl(sheetConfig.name), {
        download: true,
        // header:true だと、見出し行に空の列が多いシートで最初のデータ行が欠落するため、
        // 生の行として読み、見出しは自前で組み立てる(空見出しの列は無視する)。
        header: false,
        skipEmptyLines: true,
        complete: (results) => resolve({ ok: true, sheetConfig, rows: rowsToObjects(results.data) }),
        error: (err) => resolve({ ok: false, sheetConfig, error: err }),
      });
    });
  }

  function loadEpisodesJson() {
    return fetch('data/episodes.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  function loadEpisodeOverrides() {
    return fetch('data/episode-overrides.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }

  function buildRecordsFromSheet(sheetConfig, rows) {
    const records = [];
    rows.forEach((row, index) => {
      const episodeRaw = (row[CONFIG.episodeColumn] || '').toString().trim();
      const radioName = (row[CONFIG.radioNameColumn] || '').toString().trim();

      const parts = sheetConfig.fields.map((f) => ({
        column: f.column,
        label: f.label,
        mode: f.mode,
        combineGroup: f.combineGroup,
        breakAfter: f.breakAfter,
        breakAt: f.breakAt,
        linkTrailingUrl: f.linkTrailingUrl,
        value: (row[f.column] || '').toString().trim(),
      }));

      const hasBody = parts.some(
        (p) => (p.mode === 'normal' || p.mode === 'quoted' || p.mode === 'combine' || p.mode === 'heading') && p.value !== ''
      );
      if (!hasBody) return; // 本文がすべて空の行は表示しない

      const searchableText = normalizeText(
        [radioName].concat(
          parts
            .filter((p) => p.mode === 'normal' || p.mode === 'quoted' || p.mode === 'combine' || p.mode === 'heading')
            .map((p) => p.value)
        ).join(' ')
      );

      records.push({
        sheetName: sheetConfig.name,
        sheetLabel: sheetConfig.displayName || sheetConfig.name,
        episodeRaw,
        episodeNumeric: parseEpisodeNumeric(episodeRaw),
        radioName,
        parts,
        searchableText,
        order: allRecords.length + records.length,
      });
    });
    return records;
  }

  function episodeLink(record) {
    if (record.episodeNumeric === null || !Number.isInteger(record.episodeNumeric)) return null;
    const key = String(record.episodeNumeric);
    const override = episodeOverrides[key];
    if (override && override.url) return override.url;
    const ep = episodesData.episodes && episodesData.episodes[key];
    return ep && ep.url ? ep.url : null;
  }

  // ---------- 描画 ----------

  function highlightTerms(escapedText, terms) {
    if (!terms.length) return escapedText;
    let html = escapedText;
    terms.forEach((term) => {
      if (!term) return;
      const re = new RegExp(escapeRegExp(term), 'ig');
      html = html.replace(re, (m) => `<mark>${m}</mark>`);
    });
    return html;
  }

  // breakAfter/breakAt の指定にもとづいて、値を表示用の行に分ける(改行しない項目は1行のまま)。
  function splitIntoLines(part) {
    if (part.breakAt) {
      // 一致した文字そのものは表示に残さず、そこで区切って改行する(例: 本文中の「---」)
      return part.value
        .split(part.breakAt)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (part.breakAfter) {
      const MARK = '\u0001';
      const text = part.value
        .replace(part.breakAfter, (m) => m + MARK)
        .replace(new RegExp(MARK + '[\\s\\u3000]+', 'g'), MARK) // 直後の空白・元の改行は吸収する
        .replace(/\r?\n/g, ' '); // その他の元の改行は従来どおり空白扱い
      return text
        .split(MARK)
        .map((line) => line.trim())
        .filter(Boolean);
    }
    return [part.value];
  }

  // 本文の最後がURLで終わっていれば、「この投稿をみる」のリンクに変える(URLの文字は表示に出さない)
  const TRAILING_URL_RE = /^([\s\S]*?)\s*(https?:\/\/\S+)\s*$/;

  function linkifyTrailingUrl(line, hl) {
    const m = TRAILING_URL_RE.exec(line);
    if (!m) return null;
    const prefix = m[1].trim();
    const linkHtml = `<a href="${escapeHtml(m[2])}" target="_blank" rel="noopener">この投稿をみる</a>`;
    return prefix ? `${hl(prefix)} ${linkHtml}` : linkHtml;
  }

  // 値をHTMLにする。
  function valueHtml(part, hl) {
    const lines = splitIntoLines(part);
    if (!lines.length) return '';
    return lines
      .map((line, i) => {
        if (part.linkTrailingUrl && i === lines.length - 1) {
          const linked = linkifyTrailingUrl(line, hl);
          if (linked !== null) return linked;
        }
        return hl(line);
      })
      .join('<br>');
  }

  function buildBodyHtml(record, terms) {
    const hl = (raw) => highlightTerms(escapeHtml(raw), terms);
    let html = '';

    const heading = record.parts.filter((p) => p.mode === 'heading' && p.value);
    heading.forEach((p) => {
      html += `<p class="field field-heading">${hl(p.value)}</p>`;
    });

    const quoted = record.parts.filter((p) => p.mode === 'quoted' && p.value);
    if (quoted.length) {
      const line = quoted.map((p) => `${escapeHtml(p.label)}「${hl(p.value)}」`).join('<br>');
      html += `<p class="field field-quoted">${line}</p>`;
    }

    const combineGroups = {};
    record.parts
      .filter((p) => p.mode === 'combine' && p.value)
      .forEach((p) => {
        (combineGroups[p.combineGroup] = combineGroups[p.combineGroup] || []).push(p.value);
      });
    Object.values(combineGroups).forEach((vals) => {
      html += `<p class="field field-combine">${vals.map((v) => hl(v)).join('<br>')}</p>`;
    });

    const normal = record.parts.filter((p) => p.mode === 'normal' && p.value);
    normal.forEach((p) => {
      html += `<div class="field field-normal"><span class="field-label">${escapeHtml(p.label)}</span><span class="field-value">${valueHtml(p, hl)}</span></div>`;
    });

    return html;
  }

  function buildBadgesHtml(record) {
    return record.parts
      .filter((p) => p.mode === 'badge' && p.value)
      .map((p) => `<span class="badge badge-mark">${escapeHtml(p.label)}</span>`)
      .join('');
  }

  function renderCard(record, terms) {
    const li = document.createElement('li');
    li.className = 'result-card';

    // 放送回: Apple Podcastsへのリンクではなく、その回だけの絞り込みボタン(数値として解釈できない回は押せない)
    const episodeChip = record.episodeRaw
      ? record.episodeNumeric !== null
        ? `<button type="button" class="pill badge-episode" data-episode="${escapeHtml(record.episodeNumeric)}" title="この回の投稿だけに絞り込む">${escapeHtml(record.episodeRaw)}回</button>`
        : `<span class="pill badge-episode">${escapeHtml(record.episodeRaw)}回</span>`
      : '';

    const radioNameChip = record.radioName
      ? `<button type="button" class="pill radioname-chip" data-radioname="${escapeHtml(record.radioName)}" title="この人の投稿だけに絞り込む"><span class="pill-label">ラジオネーム：</span>${highlightTerms(escapeHtml(record.radioName), terms)}</button>`
      : '';

    // カード右下: この回のApple Podcastsへのリンク(紐づけできない回は出さない)
    const link = episodeLink(record);
    const footer = link
      ? `<div class="card-footer"><a class="podcast-link" href="${escapeHtml(link)}" target="_blank" rel="noopener">この回をPodcastで聞く</a></div>`
      : '';

    li.innerHTML = `
      <div class="card-header">
        <span class="pill sheet-chip">${escapeHtml(record.sheetLabel)}</span>
        ${episodeChip}
        ${radioNameChip}
        ${buildBadgesHtml(record)}
      </div>
      <div class="card-body">${buildBodyHtml(record, terms)}</div>
      ${footer}
    `;
    return li;
  }

  // 検索・絞り込みが1つでも実施されているか。実施されていなければトップ(最新回の投稿)を表示する。
  function isSearching() {
    return (
      state.keyword.trim() !== '' ||
      state.radioQuery.trim() !== '' ||
      state.radioExact !== null ||
      state.epFrom !== null ||
      state.epTo !== null ||
      state.activeSheet !== 'ALL'
    );
  }

  // トップに表示する投稿の回番号 = 投稿(本文あり)が登録されている最新の整数回。
  // スプレッドシートへの登録は配信より遅れるため、バナーの最新回とは一致しないことがある。
  function latestEpisodeNo() {
    let max = null;
    allRecords.forEach((r) => {
      if (r.episodeNumeric !== null && Number.isInteger(r.episodeNumeric) && (max === null || r.episodeNumeric > max)) {
        max = r.episodeNumeric;
      }
    });
    return max;
  }

  // 「お題一覧」(トップページにだけ表示)。放送回ごとに1件、降順で並べる。
  let odaiListData = [];

  function buildOdaiList() {
    const cfg = CONFIG.odaiList;
    if (!cfg) return [];
    const byEpisode = new Map();
    allRecords.forEach((r) => {
      if (r.sheetName !== cfg.sheetName) return;
      if (r.episodeNumeric === null || byEpisode.has(r.episodeNumeric)) return;
      const topic = getColumnValue(r, cfg.column);
      if (!topic) return;
      byEpisode.set(r.episodeNumeric, { epNumeric: r.episodeNumeric, epRaw: r.episodeRaw, topic });
    });
    return [...byEpisode.values()].sort((a, b) => b.epNumeric - a.epNumeric);
  }

  function renderOdaiList() {
    const cfg = CONFIG.odaiList;
    const section = document.getElementById('odai-section');
    if (!cfg || !odaiListData.length) {
      section.hidden = true;
      return;
    }
    document.querySelector('#odai-section .odai-heading').textContent = cfg.heading;
    document.getElementById('odai-list').innerHTML = odaiListData
      .map(
        (item) =>
          `<li><button type="button" class="odai-item" data-episode="${escapeHtml(item.epNumeric)}">` +
          `<span class="pill odai-episode">${escapeHtml(item.epRaw)}回</span>` +
          `<span class="odai-text">${escapeHtml(item.topic)}</span>` +
          `</button></li>`
      )
      .join('');
    // 表示・非表示は render() が、検索中かどうかに応じて切り替える
  }

  // 「ランダム表示」(トップページにだけ表示)。リスナージングル以外の現行コーナー(「その他」も除く)が対象。
  // 放送回・ラジオネームがどちらも空の投稿は、実質的に空の行(スプレッドシート側のテンプレート文字列の
  // 残りなど)である可能性が高いため、ランダム表示には出さない。
  function randomPickPool() {
    const cg = CONFIG.cornerGroups;
    const otherSheetName = cg ? cg.sheetName : null;
    const eligibleSheetNames = new Set(
      CONFIG.sheets.filter((s) => s.name !== otherSheetName && !s.randomPickExclude).map((s) => s.name)
    );
    return allRecords.filter((r) => eligibleSheetNames.has(r.sheetName) && (r.episodeRaw !== '' || r.radioName !== ''));
  }

  function pickRandomRecord() {
    const pool = randomPickPool();
    if (!pool.length) return null;
    let candidate = pool[Math.floor(Math.random() * pool.length)];
    // できれば直前と同じ投稿を続けて出さない(プールが1件しかなければそのまま)
    let guard = 0;
    while (pool.length > 1 && candidate === state.randomPickRecord && guard < 10) {
      candidate = pool[Math.floor(Math.random() * pool.length)];
      guard += 1;
    }
    return candidate;
  }

  function renderRandomPick() {
    const section = document.getElementById('random-pick-section');
    const body = document.getElementById('random-pick-body');
    const pool = randomPickPool();
    section.hidden = isSearching() || pool.length === 0;
    if (section.hidden) return;
    if (state.randomPickRecord === null) {
      body.innerHTML = '<p class="random-pick-intro">投稿をランダムに1つ表示します。右上の⟳ボタンで切り替えます。</p>';
      return;
    }
    body.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'results-list random-pick-list';
    ul.appendChild(renderCard(state.randomPickRecord, []));
    body.appendChild(ul);
  }

  function render() {
    const resultsList = document.getElementById('results-list');
    const resultCount = document.getElementById('result-count');
    const loadMore = document.getElementById('load-more');
    const sortToggle = document.getElementById('sort-toggle');
    const banner = document.getElementById('latest-episode');
    const emptyMessage = document.getElementById('empty-message');
    const latestNote = document.getElementById('latest-note');

    const searching = isSearching();
    const latestNo = latestEpisodeNo();
    // バナー(Apple Podcasts側)の最新回が、スプレッドシート側の最新回(投稿がある最新の整数回)より新しい間は、
    // スプレッドシートへの登録が追いついていないということなので、折り畳み表示は出さず、未登録の旨だけを見せる。
    const bannerNo = episodesData.latest && Number.isInteger(episodesData.latest.no) ? episodesData.latest.no : null;
    const pendingRegistration = !searching && bannerNo !== null && latestNo !== null && bannerNo > latestNo;
    renderActiveFilters();
    renderSubFilters();

    const filtered = getFiltered();
    const sorted = getSorted(filtered);
    const visible = sorted.slice(0, state.visibleCount);

    const keywordTerms = state.keyword.split(/[\s\u3000]+/).map((t) => t.trim()).filter(Boolean);

    resultsList.innerHTML = '';
    const frag = document.createDocumentFragment();
    visible.forEach((record) => frag.appendChild(renderCard(record, keywordTerms)));
    resultsList.appendChild(frag);

    // トップ: 最新回のバナー → (未登録なら)未登録の旨の表示 → 最新回の投稿(初期は折りたたみ) → ランダム表示。
    // 検索を実施したときだけ検索結果を出す。見出しの行は、トップでは「開閉ボタン」として働く(検索中は普通の見出し)。
    const header = document.querySelector('.results-header');
    if (searching) {
      header.classList.remove('is-toggle');
      header.removeAttribute('role');
      header.removeAttribute('tabindex');
      header.removeAttribute('aria-expanded');
      header.removeAttribute('aria-controls');
    } else {
      header.classList.add('is-toggle');
      header.setAttribute('role', 'button');
      header.tabIndex = 0;
      header.setAttribute('aria-expanded', String(state.topOpen));
      header.setAttribute('aria-controls', 'results-list');
    }
    // バナーの最新回がスプレッドシートにまだ登録されていない間は、折り畳み表示(見出し・一覧・さらに表示)ごと隠す
    header.hidden = pendingRegistration;
    const collapsed = !searching && !state.topOpen;
    resultsList.hidden = collapsed || pendingRegistration;

    banner.hidden = searching || !latestBannerReady;
    sortToggle.hidden = !searching;
    document.getElementById('reset-all').hidden = !searching;
    document.getElementById('odai-section').hidden = searching || !odaiListData.length;
    renderRandomPick();

    if (searching) {
      resultCount.textContent = `${sorted.length}件 / 全${allRecords.length}件`;
      emptyMessage.textContent = sorted.length === 0 ? '該当する投稿が見つかりませんでした。' : '';
    } else {
      resultCount.textContent = latestNo === null ? '' : `第${latestNo}回の投稿 ${sorted.length}件`;
      emptyMessage.textContent =
        sorted.length === 0 && latestNo !== null
          ? `第${latestNo}回の投稿は、まだスプレッドシートに登録されていません。`
          : '';
    }
    emptyMessage.hidden = emptyMessage.textContent === '' || pendingRegistration;

    // バナーの最新回の投稿がまだ登録されていない場合は、その旨を伝える(折り畳み表示の代わりにこちらを見せる)
    if (pendingRegistration) {
      latestNote.textContent = `最新の第${bannerNo}回の投稿は、まだスプレッドシートに登録されていません。登録され次第、表示されます。`;
      latestNote.hidden = false;
    } else {
      latestNote.hidden = true;
    }

    loadMore.hidden = collapsed || pendingRegistration || sorted.length <= state.visibleCount;
  }

  function getFiltered() {
    if (!isSearching()) {
      const latestNo = latestEpisodeNo();
      return allRecords.filter((r) => latestNo !== null && r.episodeNumeric === latestNo);
    }

    const kwTerms = state.keyword.split(/[\s　]+/).map(normalizeText).filter(Boolean);
    const radioQueryNorm = normalizeText(state.radioQuery);

    return allRecords.filter((r) => {
      if (state.activeSheet !== 'ALL' && r.sheetName !== state.activeSheet) return false;

      if (state.subFilter !== null) {
        const sub = findActiveSubFilter();
        if (sub) {
          if (sub.type === 'mark') {
            if (!hasMark(r, sub.column)) return false;
          } else if (sub.type === 'value') {
            const val = getColumnValue(r, sub.column);
            if (state.subFilter.value === '__other__') {
              const explicitValues = sub.options.filter((o) => !o.other).map((o) => o.value);
              if (val === '' || explicitValues.includes(val)) return false;
            } else if (val !== state.subFilter.value) {
              return false;
            }
          } else if (sub.type === 'dynamic-value') {
            // 選択肢をあらかじめ持たないため、列の値そのものと比べる(空欄は groupEmptyAs にまとめる)
            if (dynamicGroupValue(r, sub) !== state.subFilter.value) return false;
          }
        }
      }

      // 「コーナーで絞り込み」の期間限定/終了済み/その他(CONFIG.cornerGroups 経由の絞り込み)
      const cg = CONFIG.cornerGroups;
      if (cg && state.activeSheet === cg.sheetName && state.cornerKey !== null) {
        const options = allCornerOptions();
        if (state.cornerKey === '__other__') {
          if (options.some((opt) => cornerOptionMatches(r, opt))) return false;
          // さらに、その他の中の特定のテーマで絞り込む(空欄は「-」として扱う)
          if (state.otherThemeValue !== null) {
            const raw = getColumnValue(r, cg.column);
            if ((raw === '' ? '-' : raw) !== state.otherThemeValue) return false;
          }
        } else {
          const opt = options.find((o) => o.key === state.cornerKey);
          if (opt && !cornerOptionMatches(r, opt)) return false;
        }
      }

      if (state.radioExact !== null && r.radioName !== state.radioExact) return false;

      if (radioQueryNorm && !normalizeText(r.radioName).includes(radioQueryNorm)) return false;

      if (state.epFrom !== null || state.epTo !== null) {
        const num = r.episodeNumeric === null ? Infinity : r.episodeNumeric;
        if (state.epFrom !== null && num < state.epFrom) return false;
        if (state.epTo !== null && num > state.epTo) return false;
      }

      if (kwTerms.length && !kwTerms.every((t) => r.searchableText.includes(t))) return false;

      return true;
    });
  }

  function getSorted(records) {
    if (state.sortMode === 'original') {
      return records.slice().sort((a, b) => a.order - b.order);
    }
    const dir = state.sortMode === 'asc' ? 1 : -1;
    return records.slice().sort((a, b) => {
      const aNum = a.episodeNumeric;
      const bNum = b.episodeNumeric;
      const aMissing = aNum === null;
      const bMissing = bNum === null;
      if (aMissing && bMissing) return a.order - b.order;
      if (aMissing) return 1; // 数値化できない回は常に末尾
      if (bMissing) return -1;
      if (aNum !== bNum) return (aNum - bNum) * dir;
      return a.order - b.order;
    });
  }

  function renderErrorBanner() {
    const banner = document.getElementById('error-banner');
    if (!loadErrors.length) {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }
    banner.hidden = false;
    banner.innerHTML =
      '<p>次のシートを読み込めませんでした(シート名の綴りや共有設定をご確認ください):</p><ul>' +
      loadErrors.map((e) => `<li>${escapeHtml(e.sheetName)}: ${escapeHtml(e.message)}</li>`).join('') +
      '</ul>';
  }

  function renderLatestEpisode() {
    const el = document.getElementById('latest-episode');
    const latest = episodesData.latest;
    if (!latest || !latest.no) {
      latestBannerReady = false;
      el.innerHTML = '';
      return;
    }
    latestBannerReady = true;
    // 「◆281【本編】」の接頭辞は回番号と重複するので、タイトルから外す
    const title = (latest.title || '').replace(/^\s*◆\s*\d+(?:\.\d+)?\s*【.+?】\s*/, '') || latest.title || '';
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(latest.date || '');
    const dateText = dm ? `${dm[1]}年${Number(dm[2])}月${Number(dm[3])}日配信` : '';
    el.innerHTML =
      '<span class="latest-label">最新回</span>' +
      `<p class="latest-no"><span class="latest-num">${escapeHtml(latest.no)}</span><span class="latest-unit">回</span></p>` +
      `<p class="latest-title">${escapeHtml(title)}</p>` +
      (dateText ? `<p class="latest-date">${dateText}</p>` : '') +
      (latest.url
        ? `<a class="latest-btn" href="${escapeHtml(latest.url)}" target="_blank" rel="noopener">Apple Podcastsで聴く</a>`
        : '');
  }

  function hasMark(record, column) {
    return record.parts.some((p) => p.column === column && p.mode === 'badge' && p.value !== '');
  }

  function getColumnValue(record, column) {
    const p = record.parts.find((pp) => pp.column === column);
    return p ? p.value : '';
  }

  // type: 'dynamic-value' で、絞り込みに使う値。空欄は、sub.groupEmptyAs が指定されていれば、その値にまとめる
  // (例: テーマが空欄の投稿を、「-」の投稿と同じ「-（件名不明）」にまとめる)。
  function dynamicGroupValue(record, sub) {
    const raw = getColumnValue(record, sub.column);
    return raw === '' && sub.groupEmptyAs !== undefined ? sub.groupEmptyAs : raw;
  }

  // type: 'dynamic-value' の選択肢を、今読み込んでいるデータから毎回拾い集める(件数の多い順。同数は五十音順)。
  // あらかじめ選択肢を書かないので、スプレッドシート側に新しい値が増えても、そのまま反映される。
  function dynamicSubFilterOptions(sheetName, sub) {
    const counts = new Map();
    allRecords.forEach((r) => {
      if (r.sheetName !== sheetName) return;
      const val = dynamicGroupValue(r, sub);
      if (val === '') return;
      counts.set(val, (counts.get(val) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
      .map(([value, count]) => ({
        value,
        count,
        label: (sub.labelOverrides && sub.labelOverrides[value]) || value,
      }));
  }

  // CONFIG.cornerGroups の「期間限定」「終了済み」をまとめた一覧
  function allCornerOptions() {
    const cg = CONFIG.cornerGroups;
    if (!cg) return [];
    return (cg.limited || []).concat(cg.ended || []);
  }

  // 「その他」(期間限定/終了済みのどれにも当てはまらない投稿)の中の、実際のテーマの値ごとの一覧。
  // 「ガクナッシュ」などと違って名前を決め打ちできないので、読み込んだデータから毎回拾い集める(件数の多い順。同数は五十音順)。
  // テーマが空欄の投稿は「-」として、テーマが「-」の投稿と同じ扱いにする。
  function dynamicOtherThemeOptions() {
    const cg = CONFIG.cornerGroups;
    const options = allCornerOptions();
    const counts = new Map();
    allRecords.forEach((r) => {
      if (r.sheetName !== cg.sheetName) return;
      if (options.some((opt) => cornerOptionMatches(r, opt))) return; // 期間限定/終了済みに該当する投稿は除く
      const raw = getColumnValue(r, cg.column);
      const value = raw === '' ? '-' : raw;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
      .map(([value, count]) => ({ value, count, label: value === '-' ? '-（件名不明）' : value }));
  }

  // 投稿の対象列の値が、コーナー定義(opt)に一致するか。match(正規表現)があればそれで、なければ label と完全一致で判定する。
  function cornerOptionMatches(record, opt) {
    const val = getColumnValue(record, CONFIG.cornerGroups.column);
    return opt.match ? opt.match.test(val) : val === opt.label;
  }

  // 現在の activeSheet に定義されている、state.subFilter.key と一致する追加の絞り込みの定義
  function findActiveSubFilter() {
    if (state.subFilter === null) return null;
    const sheetConfig = CONFIG.sheets.find((s) => s.name === state.activeSheet);
    if (!sheetConfig) return null;
    return (sheetConfig.subFilters || []).find((sub) => sub.key === state.subFilter.key) || null;
  }

  // 「コーナーで絞り込み」: すべて / 現行コーナー(常に表示) / 期間限定・終了済み・その他(折りたたみ)
  function renderCornerFilter() {
    const mainContainer = document.getElementById('corner-filter-main');
    const moreContainer = document.getElementById('corner-filter-more');
    const cg = CONFIG.cornerGroups;
    const otherSheetName = cg ? cg.sheetName : null;
    const inOtherGroup = cg !== undefined && cg !== null && state.activeSheet === otherSheetName && state.cornerKey !== null;

    const allActive = state.activeSheet === 'ALL' ? ' is-active' : '';
    const allHtml = `<button type="button" class="filter-btn${allActive}" data-corner-all="1">すべて</button>`;

    const currentSheets = CONFIG.sheets.filter((s) => s.name !== otherSheetName);
    const currentHtml = currentSheets
      .map((s) => {
        const active = state.activeSheet === s.name ? ' is-active' : '';
        return `<button type="button" class="filter-btn${active}" data-sheet="${escapeHtml(s.name)}">${escapeHtml(s.displayName || s.name)}</button>`;
      })
      .join('');

    let moreHtml = '';
    if (cg) {
      const cornerBtn = (opt) => {
        const active = inOtherGroup && state.cornerKey === opt.key ? ' is-active' : '';
        return `<button type="button" class="filter-btn${active}" data-corner-key="${escapeHtml(opt.key)}">${escapeHtml(opt.label)}</button>`;
      };
      const inOther = inOtherGroup && state.cornerKey === '__other__';
      const otherAllActive = inOther && state.otherThemeValue === null ? ' is-active' : '';
      const otherAllHtml = `<button type="button" class="filter-btn${otherAllActive}" data-corner-key="__other__">${escapeHtml(cg.otherLabel || 'その他')}全て</button>`;
      const otherThemeBtn = (opt) => {
        const active = inOther && state.otherThemeValue === opt.value ? ' is-active' : '';
        return (
          `<button type="button" class="filter-btn${active}" data-corner-key="__other__" data-other-theme="${escapeHtml(opt.value)}">` +
          `${escapeHtml(opt.label)}</button>`
        );
      };
      const otherThemeOptions = dynamicOtherThemeOptions();

      // 「終了済み」は、cg.ended が空の間(竹富島・日常RTAのように専用シート追加待ちの場合など)は見出しごと出さない
      const endedOptions = cg.ended || [];
      const endedHtml = endedOptions.length
        ? `<div class="corner-subgroup">
            <span class="corner-subgroup-label">終了済み</span>
            <div class="corner-row">${endedOptions.map(cornerBtn).join('')}</div>
          </div>`
        : '';
      const summaryLabel = endedOptions.length ? '期間限定・終了済み・その他のコーナー' : '期間限定・その他のコーナー';

      moreHtml = `
        <details class="corner-more"${inOtherGroup ? ' open' : ''}>
          <summary>${summaryLabel}</summary>
          <div class="corner-subgroup">
            <span class="corner-subgroup-label">期間限定</span>
            <div class="corner-row">${(cg.limited || []).map(cornerBtn).join('')}</div>
          </div>
          ${endedHtml}
          <div class="corner-subgroup">
            <span class="corner-subgroup-label">その他</span>
            <div class="corner-row">${otherAllHtml}${otherThemeOptions.map(otherThemeBtn).join('')}</div>
          </div>
        </details>
      `;
    }

    // コーナー固有の追加の絞り込み(#sub-filter)を、「現行コーナー」の直下・「期間限定〜」の上に
    // そのまま表示できるよう、2つのコンテナに分けて描画する(#sub-filter はこの間の静的なHTML要素)
    mainContainer.innerHTML =
      `<div class="corner-row corner-row-all">${allHtml}</div>` + `<div class="corner-row corner-row-current">${currentHtml}</div>`;
    moreContainer.innerHTML = moreHtml;
  }

  function updateSortButtonLabel() {
    const btn = document.getElementById('sort-toggle');
    const labels = { original: 'コーナー順', asc: '放送回昇順', desc: '放送回降順' };
    btn.textContent = `並び替え: ${labels[state.sortMode]}`;
  }

  // 適用中の絞り込み(コーナー・ラジオネームの完全一致・放送回の範囲)を、解除ボタン付きのチップで見せる
  function episodeRangeText() {
    const f = state.epFrom;
    const t = state.epTo;
    if (f === null && t === null) return null;
    if (f !== null && t !== null) return f === t ? `第${f}回` : `第${f}〜${t}回`;
    return f !== null ? `第${f}回以降` : `第${t}回まで`;
  }

  // 現在選ばれているコーナーの表示名(「すべて」のときは null)。「コーナーで絞り込み」のボタン表示に合わせる
  function cornerActiveLabel() {
    if (state.activeSheet === 'ALL') return null;
    const cg = CONFIG.cornerGroups;
    if (cg && state.activeSheet === cg.sheetName) {
      if (state.cornerKey === '__other__') {
        if (state.otherThemeValue === null) return `${cg.otherLabel || 'その他'}全て`;
        const opt = dynamicOtherThemeOptions().find((o) => o.value === state.otherThemeValue);
        return opt ? opt.label : state.otherThemeValue;
      }
      const opt = allCornerOptions().find((o) => o.key === state.cornerKey);
      return opt ? opt.label : null;
    }
    const sheetConfig = CONFIG.sheets.find((s) => s.name === state.activeSheet);
    return sheetConfig ? sheetConfig.displayName || sheetConfig.name : state.activeSheet;
  }

  function renderActiveFilters() {
    const box = document.getElementById('active-filters');
    const items = [];
    const cornerLabel = cornerActiveLabel();
    if (cornerLabel !== null) items.push({ key: 'corner', text: `コーナー：${cornerLabel}` });
    const epText = episodeRangeText();
    if (epText !== null) items.push({ key: 'episode', text: epText });
    if (state.radioExact !== null) {
      items.push({ key: 'radio', text: `ラジオネーム：${state.radioExact}` });
    }

    box.hidden = items.length === 0;
    box.innerHTML = items
      .map(
        (it) =>
          `<span class="active-chip"><span class="active-chip-text">${escapeHtml(it.text)}</span>` +
          `<button type="button" class="active-chip-clear" data-clear="${it.key}" aria-label="${escapeHtml(it.text)}の絞り込みを解除">解除</button></span>`
      )
      .join('');

    // 「ラジオネームで絞り込み」内にも、コーナー(ボタンの選択)・放送回(入力欄の値)と同様に、現在の選択状態をその場で表示する
    const status = document.getElementById('radioname-exact-status');
    status.hidden = state.radioExact === null;
    if (state.radioExact !== null) {
      document.getElementById('radioname-exact-status-text').textContent = state.radioExact;
    }
  }

  // シートを選んだときだけ現れる、追加の絞り込み(お眼鏡賞のみ表示、正解で絞り込む、など)
  function renderSubFilters() {
    const container = document.getElementById('sub-filter');
    const sheetConfig = CONFIG.sheets.find((s) => s.name === state.activeSheet);
    const subs = sheetConfig ? sheetConfig.subFilters || [] : [];
    if (!subs.length) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    container.hidden = false;
    container.innerHTML = subs
      .map((sub) => {
        if (sub.type === 'mark') {
          const active = state.subFilter && state.subFilter.key === sub.key ? ' is-active' : '';
          return (
            `<div class="sub-filter-group">` +
            `<button type="button" class="filter-btn filter-btn-sub${active}" data-subfilter="${escapeHtml(sub.key)}" data-subvalue="">` +
            `${escapeHtml(sub.label)}</button></div>`
          );
        }
        // type: 'value' … あらかじめ書かれた options / type: 'dynamic-value' … データから毎回拾い集めた選択肢
        const options = sub.type === 'dynamic-value' ? dynamicSubFilterOptions(state.activeSheet, sub) : sub.options;
        const optionButtons = [{ value: '', label: 'すべて' }].concat(options)
          .map((opt) => {
            const isAll = opt.value === '';
            const active =
              (isAll && (!state.subFilter || state.subFilter.key !== sub.key)) ||
              (!isAll && state.subFilter && state.subFilter.key === sub.key && state.subFilter.value === opt.value)
                ? ' is-active'
                : '';
            return (
              `<button type="button" class="filter-btn filter-btn-sub${active}" data-subfilter="${escapeHtml(sub.key)}" data-subvalue="${escapeHtml(opt.value)}">` +
              `${escapeHtml(opt.label)}</button>`
            );
          })
          .join('');
        return (
          `<div class="sub-filter-group"><span class="sub-filter-label">${escapeHtml(sub.label)}で絞り込み：</span>${optionButtons}</div>`
        );
      })
      .join('');
  }

  // ---------- イベント ----------

  function resetPaging() {
    state.visibleCount = PAGE_SIZE;
  }

  // 検索・絞り込み・並び替えをすべて初期状態に戻す(=トップ画面に戻る)
  function resetAll() {
    state.keyword = '';
    state.radioQuery = '';
    state.radioExact = null;
    state.activeSheet = 'ALL';
    state.subFilter = null;
    state.cornerKey = null;
    state.otherThemeValue = null;
    state.epFrom = null;
    state.epTo = null;
    state.sortMode = 'original';
    state.topOpen = false;
    state.randomPickRecord = null; // ランダム表示も、説明文の初期状態に戻す
    resetPaging();
    ['keyword-input', 'radioname-input', 'episode-from', 'episode-to'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    updateSortButtonLabel();
    renderCornerFilter();
    render();
  }

  // お題をタップしたときの絞り込み: そのシート + その回だけにする(ほかの検索・絞り込みは解除する)
  function applyOdaiFilter(epNumeric) {
    const cfg = CONFIG.odaiList;
    if (!cfg) return;
    state.keyword = '';
    state.radioQuery = '';
    state.radioExact = null;
    state.activeSheet = cfg.sheetName;
    state.subFilter = null;
    state.cornerKey = null;
    state.otherThemeValue = null;
    state.epFrom = epNumeric;
    state.epTo = epNumeric;
    resetPaging();
    document.getElementById('keyword-input').value = '';
    document.getElementById('radioname-input').value = '';
    document.getElementById('episode-from').value = String(epNumeric);
    document.getElementById('episode-to').value = String(epNumeric);
    renderCornerFilter();
    render();
    window.scrollTo(0, 0);
  }

  function setupEvents() {
    const keywordInput = document.getElementById('keyword-input');
    const radioInput = document.getElementById('radioname-input');
    const epFrom = document.getElementById('episode-from');
    const epTo = document.getElementById('episode-to');
    const sortToggle = document.getElementById('sort-toggle');
    const loadMore = document.getElementById('load-more');
    const cornerFilter = document.getElementById('corner-filter');
    const activeFilters = document.getElementById('active-filters');
    const resetAllBtn = document.getElementById('reset-all');
    const resultsList = document.getElementById('results-list');

    const onKeyword = debounce(() => {
      state.keyword = keywordInput.value;
      resetPaging();
      render();
    }, 150);
    keywordInput.addEventListener('input', onKeyword);

    const onRadioQuery = debounce(() => {
      state.radioQuery = radioInput.value;
      resetPaging();
      render();
    }, 150);
    radioInput.addEventListener('input', onRadioQuery);

    const onEpisodeRange = debounce(() => {
      const fromVal = epFrom.value.trim();
      const toVal = epTo.value.trim();
      state.epFrom = fromVal === '' ? null : parseFloat(fromVal);
      state.epTo = toVal === '' ? null : parseFloat(toVal);
      resetPaging();
      render();
    }, 150);
    epFrom.addEventListener('input', onEpisodeRange);
    epTo.addEventListener('input', onEpisodeRange);

    sortToggle.addEventListener('click', () => {
      state.sortMode = state.sortMode === 'original' ? 'asc' : state.sortMode === 'asc' ? 'desc' : 'original';
      updateSortButtonLabel();
      resetPaging();
      render();
    });

    loadMore.addEventListener('click', () => {
      state.visibleCount += PAGE_SIZE;
      render();
    });

    cornerFilter.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      state.otherThemeValue = null;
      if (btn.dataset.cornerAll) {
        state.activeSheet = 'ALL';
        state.cornerKey = null;
      } else if (btn.dataset.sheet) {
        state.activeSheet = btn.dataset.sheet;
        state.cornerKey = null;
      } else if (btn.dataset.cornerKey) {
        state.activeSheet = CONFIG.cornerGroups.sheetName;
        state.cornerKey = btn.dataset.cornerKey;
        if (btn.dataset.otherTheme !== undefined) state.otherThemeValue = btn.dataset.otherTheme;
      } else {
        return;
      }
      state.subFilter = null;
      renderCornerFilter();
      resetPaging();
      render();
    });

    // 追加の絞り込み(サブフィルター)のボタン
    document.getElementById('sub-filter').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn-sub');
      if (!btn) return;
      const key = btn.dataset.subfilter;
      const sheetConfig = CONFIG.sheets.find((s) => s.name === state.activeSheet);
      const sub = sheetConfig && (sheetConfig.subFilters || []).find((s2) => s2.key === key);
      if (!sub) return;
      if (sub.type === 'mark') {
        state.subFilter = state.subFilter && state.subFilter.key === key ? null : { key, value: true };
      } else {
        state.subFilter = btn.dataset.subvalue === '' ? null : { key, value: btn.dataset.subvalue };
      }
      resetPaging();
      render();
    });

    // 適用中の絞り込みの「解除」(固定の検索窓の下のチップと、「ラジオネームで絞り込み」内の表示、両方から呼ばれる)
    const clearActiveFilter = (key) => {
      if (key === 'radio') {
        state.radioExact = null;
      } else if (key === 'episode') {
        state.epFrom = null;
        state.epTo = null;
        epFrom.value = '';
        epTo.value = '';
      } else if (key === 'corner') {
        state.activeSheet = 'ALL';
        state.cornerKey = null;
        state.otherThemeValue = null;
        state.subFilter = null;
        renderCornerFilter();
      } else {
        return;
      }
      resetPaging();
      render();
    };
    activeFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.active-chip-clear');
      if (btn) clearActiveFilter(btn.dataset.clear);
    });
    document.getElementById('radioname-exact-status').addEventListener('click', (e) => {
      const btn = e.target.closest('.active-chip-clear');
      if (btn) clearActiveFilter(btn.dataset.clear);
    });

    resetAllBtn.addEventListener('click', resetAll);

    // トップでは、見出しの行をタップ(またはEnter/Space)すると、最新回の投稿を開閉する
    const resultsHeader = document.querySelector('.results-header');
    const toggleTop = () => {
      if (!resultsHeader.classList.contains('is-toggle')) return;
      state.topOpen = !state.topOpen;
      render();
    };
    resultsHeader.addEventListener('click', toggleTop);
    resultsHeader.addEventListener('keydown', (e) => {
      if (e.target !== resultsHeader) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleTop();
      }
    });

    // タイトルをタップすると、最初の画面(トップ)に戻る: 検索・絞り込みをすべて解除し、絞り込みパネルを閉じて、先頭へ
    document.getElementById('site-title-link').addEventListener('click', (e) => {
      e.preventDefault();
      resetAll();
      document.getElementById('filter-panel').open = false;
      window.scrollTo(0, 0);
    });

    // 投稿カード内の放送回・ラジオネームのタップ(検索結果一覧・ランダム表示、どちらのカードでも使う)
    const handleCardClick = (e) => {
      // 放送回をタップ: その回だけに絞り込む
      const episodeBtn = e.target.closest('.badge-episode[data-episode]');
      if (episodeBtn) {
        const n = parseFloat(episodeBtn.dataset.episode);
        state.epFrom = n;
        state.epTo = n;
        epFrom.value = String(n);
        epTo.value = String(n);
        resetPaging();
        render();
        return;
      }
      // ラジオネームをタップ: その人の投稿だけに絞り込む(完全一致)
      const chip = e.target.closest('.radioname-chip');
      if (!chip) return;
      state.radioExact = chip.dataset.radioname;
      resetPaging();
      render();
    };
    resultsList.addEventListener('click', handleCardClick);
    document.getElementById('random-pick-body').addEventListener('click', handleCardClick);

    // お題一覧(トップページ)のタップ
    document.getElementById('odai-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.odai-item');
      if (!btn) return;
      applyOdaiFilter(parseFloat(btn.dataset.episode));
    });

    // ランダム表示の「⟳」: 別の投稿をランダムに選び直す
    document.getElementById('random-pick-reload').addEventListener('click', () => {
      state.randomPickRecord = pickRandomRecord();
      renderRandomPick();
    });
  }

  // ---------- 初期化 ----------

  function init() {
    setupEvents();
    updateSortButtonLabel();
    renderCornerFilter();

    Promise.all([
      Promise.all(CONFIG.sheets.map(loadSheet)),
      loadEpisodesJson(),
      loadEpisodeOverrides(),
    ]).then(([sheetResults, episodesJson, overridesJson]) => {
      episodesData = episodesJson && episodesJson.episodes ? episodesJson : { episodes: {}, latest: null };
      episodeOverrides = overridesJson || {};

      sheetResults.forEach((result) => {
        if (result.ok) {
          allRecords = allRecords.concat(buildRecordsFromSheet(result.sheetConfig, result.rows));
        } else {
          loadErrors.push({
            sheetName: result.sheetConfig.name,
            message: (result.error && result.error.message) || '読み込みに失敗しました',
          });
        }
      });

      renderErrorBanner();
      renderLatestEpisode();
      odaiListData = buildOdaiList();
      renderOdaiList();
      renderCornerFilter(); // 「その他」の中の個別テーマ一覧は、データが揃ってから出せるので、ここで作り直す
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
