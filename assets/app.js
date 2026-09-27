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
  };

  let allRecords = [];
  let episodesData = { episodes: {}, latest: null };
  let episodeOverrides = {};
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

    const link = episodeLink(record);
    const episodeBadge = record.episodeRaw
      ? link
        ? `<a class="badge badge-episode" href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(record.episodeRaw)}回</a>`
        : `<span class="badge badge-episode badge-episode-nolink">${escapeHtml(record.episodeRaw)}回</span>`
      : '';

    const radioNameHtml = record.radioName
      ? `<button type="button" class="radioname-chip" data-radioname="${escapeHtml(record.radioName)}">${highlightTerms(escapeHtml(record.radioName), terms)}</button>`
      : '';

    li.innerHTML = `
      <div class="card-header">
        ${episodeBadge}
        ${radioNameHtml}
        <span class="sheet-name">${escapeHtml(record.sheetLabel)}</span>
        ${buildBadgesHtml(record)}
      </div>
      <div class="card-body">${buildBodyHtml(record, terms)}</div>
    `;
    return li;
  }

  function render() {
    const resultsList = document.getElementById('results-list');
    const resultCount = document.getElementById('result-count');
    const loadMore = document.getElementById('load-more');

    const filtered = getFiltered();
    const sorted = getSorted(filtered);
    const visible = sorted.slice(0, state.visibleCount);

    const keywordTerms = state.keyword.split(/[\s　]+/).map((t) => t.trim()).filter(Boolean);

    resultsList.innerHTML = '';
    const frag = document.createDocumentFragment();
    visible.forEach((record) => frag.appendChild(renderCard(record, keywordTerms)));
    resultsList.appendChild(frag);

    resultCount.textContent = `${sorted.length}件 / 全${allRecords.length}件`;
    loadMore.hidden = sorted.length <= state.visibleCount;
  }

  function getFiltered() {
    const kwTerms = state.keyword.split(/[\s　]+/).map(normalizeText).filter(Boolean);
    const radioQueryNorm = normalizeText(state.radioQuery);

    return allRecords.filter((r) => {
      if (state.activeSheet !== 'ALL' && r.sheetName !== state.activeSheet) return false;

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
      el.hidden = true;
      return;
    }
    // 「◆281【本編】」の接頭辞は回番号と重複するので、タイトルから外す
    const title = (latest.title || '').replace(/^\s*◆\s*\d+(?:\.\d+)?\s*【.+?】\s*/, '') || latest.title || '';
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(latest.date || '');
    const dateText = dm ? `${dm[1]}年${Number(dm[2])}月${Number(dm[3])}日配信` : '';
    el.hidden = false;
    el.innerHTML =
      '<span class="latest-label">最新回</span>' +
      `<p class="latest-no">第${escapeHtml(latest.no)}回</p>` +
      `<p class="latest-title">${escapeHtml(title)}</p>` +
      (dateText ? `<p class="latest-date">${dateText}</p>` : '') +
      (latest.url
        ? `<a class="latest-btn" href="${escapeHtml(latest.url)}" target="_blank" rel="noopener">Apple Podcastsで聴く</a>`
        : '');
  }

  function renderSheetFilterButtons() {
    const container = document.getElementById('sheet-filter');
    const buttons = [{ name: 'ALL', label: 'すべて' }].concat(
      CONFIG.sheets.map((s) => ({ name: s.name, label: s.displayName || s.name }))
    );
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

  function updateRadioExactUi() {
    const wrap = document.getElementById('radioname-exact-filter');
    const valueEl = document.getElementById('radioname-exact-value');
    if (state.radioExact === null) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    valueEl.textContent = state.radioExact;
  }

  // ---------- イベント ----------

  function resetPaging() {
    state.visibleCount = PAGE_SIZE;
  }

  function setupEvents() {
    const keywordInput = document.getElementById('keyword-input');
    const radioInput = document.getElementById('radioname-input');
    const epFrom = document.getElementById('episode-from');
    const epTo = document.getElementById('episode-to');
    const sortToggle = document.getElementById('sort-toggle');
    const loadMore = document.getElementById('load-more');
    const sheetFilter = document.getElementById('sheet-filter');
    const radioExactClear = document.getElementById('radioname-exact-clear');
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

    radioExactClear.addEventListener('click', () => {
      state.radioExact = null;
      updateRadioExactUi();
      resetPaging();
      render();
    });

    resultsList.addEventListener('click', (e) => {
      const chip = e.target.closest('.radioname-chip');
      if (!chip) return;
      state.radioExact = chip.dataset.radioname;
      updateRadioExactUi();
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
