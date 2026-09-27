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
    epFrom: null,
    epTo: null,
    sortMode: 'original', // 'original' | 'asc' | 'desc'
    visibleCount: PAGE_SIZE,
    topOpen: false, // トップ(最新回の投稿)の一覧を開いているか。初期は折りたたむ
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

  // 値をHTMLにする。breakAfter がある項目は、一致箇所の直後で改行する。
  function valueHtml(part, hl) {
    if (!part.breakAfter) return hl(part.value);
    const MARK = '\u0001';
    const text = part.value
      .replace(part.breakAfter, (m) => m + MARK)
      .replace(new RegExp(MARK + '[\\s\\u3000]+', 'g'), MARK) // 直後の空白・元の改行は吸収する
      .replace(/\r?\n/g, ' '); // その他の元の改行は従来どおり空白扱い
    return text
      .split(MARK)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => hl(line))
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
    renderActiveFilters();

    const filtered = getFiltered();
    const sorted = getSorted(filtered);
    const visible = sorted.slice(0, state.visibleCount);

    const keywordTerms = state.keyword.split(/[\s\u3000]+/).map((t) => t.trim()).filter(Boolean);

    resultsList.innerHTML = '';
    const frag = document.createDocumentFragment();
    visible.forEach((record) => frag.appendChild(renderCard(record, keywordTerms)));
    resultsList.appendChild(frag);

    // トップ: 検索窓 → 最新回のバナー → 最新回の投稿(初期は折りたたみ)。検索を実施したときだけ検索結果を出す。
    // 見出しの行は、トップでは「開閉ボタン」として働く(検索中は普通の見出し)。
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
    const collapsed = !searching && !state.topOpen;
    resultsList.hidden = collapsed;

    banner.hidden = searching || !latestBannerReady;
    sortToggle.hidden = !searching;
    document.getElementById('reset-all').hidden = !searching;

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
    emptyMessage.hidden = emptyMessage.textContent === '';

    // バナーの最新回の投稿がまだ登録されていない場合は、その旨を伝える
    const bannerNo = episodesData.latest && Number.isInteger(episodesData.latest.no) ? episodesData.latest.no : null;
    if (!searching && bannerNo !== null && latestNo !== null && bannerNo > latestNo) {
      latestNote.textContent = `最新の第${bannerNo}回の投稿は、まだスプレッドシートに登録されていません。登録され次第、表示されます。`;
      latestNote.hidden = false;
    } else {
      latestNote.hidden = true;
    }

    loadMore.hidden = collapsed || sorted.length <= state.visibleCount;
  }

  function getFiltered() {
    if (!isSearching()) {
      const latestNo = latestEpisodeNo();
      return allRecords.filter((r) => latestNo !== null && r.episodeNumeric === latestNo);
    }

    const kwTerms = state.keyword.split(/[\s　]+/).map(normalizeText).filter(Boolean);
    const radioQueryNorm = normalizeText(state.radioQuery);

    return allRecords.filter((r) => {
      if (state.activeSheet !== 'ALL') {
        const sub = findSubFilter(state.activeSheet);
        if (sub) {
          if (r.sheetName !== sub.sheetName || !hasMark(r, sub.markColumn)) return false;
        } else if (r.sheetName !== state.activeSheet) {
          return false;
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

  // シートの中の追加の絞り込み(印列に値がある行だけ)。ボタンの値は「シート名::key」の形にする
  function subFilterValue(sheetName, key) {
    return `${sheetName}::${key}`;
  }

  function findSubFilter(value) {
    for (const s of CONFIG.sheets) {
      for (const sub of s.subFilters || []) {
        if (subFilterValue(s.name, sub.key) === value) return { sheetName: s.name, markColumn: sub.markColumn };
      }
    }
    return null;
  }

  function hasMark(record, column) {
    return record.parts.some((p) => p.column === column && p.mode === 'badge' && p.value !== '');
  }

  function renderSheetFilterButtons() {
    const container = document.getElementById('sheet-filter');
    const buttons = [{ name: 'ALL', label: 'すべて' }];
    CONFIG.sheets.forEach((s) => {
      buttons.push({ name: s.name, label: s.displayName || s.name });
      (s.subFilters || []).forEach((sub) => {
        buttons.push({ name: subFilterValue(s.name, sub.key), label: sub.label });
      });
    });
    container.innerHTML = buttons
      .map(({ name, label }) => {
        const active = state.activeSheet === name ? ' is-active' : '';
        return `<button type="button" class="filter-btn${active}" data-sheet="${escapeHtml(name)}">${escapeHtml(label)}</button>`;
      })
      .join('');
  }

  function updateSortButtonLabel() {
    const btn = document.getElementById('sort-toggle');
    const labels = { original: '記載順', asc: '昇順', desc: '降順' };
    btn.textContent = `並び替え: ${labels[state.sortMode]}`;
  }

  // 適用中の絞り込み(ラジオネームの完全一致・放送回の範囲)を、解除ボタン付きのチップで見せる
  function episodeRangeText() {
    const f = state.epFrom;
    const t = state.epTo;
    if (f === null && t === null) return null;
    if (f !== null && t !== null) return f === t ? `第${f}回` : `第${f}〜${t}回`;
    return f !== null ? `第${f}回以降` : `第${t}回まで`;
  }

  function renderActiveFilters() {
    const box = document.getElementById('active-filters');
    const items = [];
    if (state.radioExact !== null) {
      items.push({ key: 'radio', text: `ラジオネーム：${state.radioExact}` });
    }
    const epText = episodeRangeText();
    if (epText !== null) items.push({ key: 'episode', text: epText });

    box.hidden = items.length === 0;
    box.innerHTML = items
      .map(
        (it) =>
          `<span class="active-chip"><span class="active-chip-text">${escapeHtml(it.text)}</span>` +
          `<button type="button" class="active-chip-clear" data-clear="${it.key}" aria-label="${escapeHtml(it.text)}の絞り込みを解除">解除</button></span>`
      )
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
    state.epFrom = null;
    state.epTo = null;
    state.sortMode = 'original';
    state.topOpen = false;
    resetPaging();
    ['keyword-input', 'radioname-input', 'episode-from', 'episode-to'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    updateSortButtonLabel();
    renderSheetFilterButtons();
    render();
  }

  function setupEvents() {
    const keywordInput = document.getElementById('keyword-input');
    const radioInput = document.getElementById('radioname-input');
    const epFrom = document.getElementById('episode-from');
    const epTo = document.getElementById('episode-to');
    const sortToggle = document.getElementById('sort-toggle');
    const loadMore = document.getElementById('load-more');
    const sheetFilter = document.getElementById('sheet-filter');
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

    sheetFilter.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      state.activeSheet = btn.dataset.sheet;
      renderSheetFilterButtons();
      resetPaging();
      render();
    });

    // 適用中の絞り込みの「解除」
    activeFilters.addEventListener('click', (e) => {
      const btn = e.target.closest('.active-chip-clear');
      if (!btn) return;
      if (btn.dataset.clear === 'radio') {
        state.radioExact = null;
      } else if (btn.dataset.clear === 'episode') {
        state.epFrom = null;
        state.epTo = null;
        epFrom.value = '';
        epTo.value = '';
      }
      resetPaging();
      render();
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

    resultsList.addEventListener('click', (e) => {
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
    });
  }

  // ---------- 初期化 ----------

  function init() {
    setupEvents();
    updateSortButtonLabel();
    renderSheetFilterButtons();

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
      render();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
