// config.js — シート名・列の表示ルール
// シートを追加・変更するときは、このファイルだけを直す(app.js にシート名を書かない)。
//
// シート設定の name はスプレッドシートのタブ名(取得に使うので変えない)。
// 画面での表示名を変えたいときは displayName を指定する。
//
// フィールドの mode:
//   normal  … 「ラベル: 値」の形でブロック表示。検索対象。
//   quoted  … 「ラベル「値」」の形で表示し、quoted 同士は改行で区切る。検索対象。
//   combine … combineGroup が同じフィールド同士を、ラベルなしで1つの本文として繋げて表示。検索対象。
//   heading … 本文の先頭に見出し的に表示。検索対象。
//   badge   … 値が入っていればバッジとして表示(本文には出さない)。検索対象外。
//   exclude … 表示も検索もしない(例: タイトルコール)。
//
// フィールドの breakAfter(任意・正規表現):
//   一致した箇所の直後で改行する。スプレッドシート側の改行は空白として扱う(従来どおり)。

const CONFIG = {
  // データ元スプレッドシート
  sheetId: '1-PnEwbdiTOfZ3XFLqarqBWe1WMYUfOqVkh3P3Uud-Bo',

  // 共通列名
  episodeColumn: '放送回',
  radioNameColumn: 'ラジオネーム',

  // シート別のCSV取得URLを組み立てる
  csvUrl(sheetName) {
    const base = `https://docs.google.com/spreadsheets/d/${this.sheetId}/gviz/tq`;
    const params = new URLSearchParams({
      tqx: 'out:csv',
      headers: '1',
      sheet: sheetName,
    });
    return `${base}?${params.toString()}`;
  },

  // 出典表示
  credit: {
    name: 'きゅうり大好きっ子ちゃん',
    xHandle: '@pomp364',
    xUrl: 'https://x.com/pomp364',
    sheetUrl: 'https://docs.google.com/spreadsheets/d/1-PnEwbdiTOfZ3XFLqarqBWe1WMYUfOqVkh3P3Uud-Bo/htmlview',
  },

  // Apple Podcasts 番組ページ
  podcast: {
    showId: '1567028358',
    showUrl: 'https://podcasts.apple.com/jp/podcast/id1567028358',
  },

  // シート別の絞り込みボタンの並び順(シート名=タブ名で指定する。「すべて」は常に先頭)。
  // 投稿の表示順(記載順)とは別。ここに書かれていないシートは、末尾に追加される。
  filterOrder: [
    'ともはるさん',
    'リスナージングル',
    'ラジ父大喜利',
    'ワーキャー',
    '俺にもありました',
    '優しいゴージャスさん',
    'パンダマン',
    '韻豆',
    'ガクにもわかりますか？',
    'エンディングのコーナー',
    'その他',
  ],

  // 読み込むシートと表示ルール(この順番が初期表示の記載順になる)
  sheets: [
    {
      name: 'ともはるさん',
      displayName: 'ともはるさ～ん',
      fields: [
        { column: '川北', label: '川北', mode: 'quoted' },
        { column: 'ガク', label: 'ガク', mode: 'quoted' },
        { column: 'タイトルコール', mode: 'exclude' },
      ],
    },
    {
      name: 'リスナージングル',
      fields: [
        { column: '本文', label: '本文', mode: 'normal' },
      ],
    },
    {
      name: 'エンディングのコーナー',
      fields: [
        {
          column: 'ネタ',
          label: 'ネタ',
          mode: 'normal',
          // 「〜」は番組名 / 「〜」の番組名 の直後で改行する(「は」の省略や「Amazon」のみの表記も許容)。
          // 「」の直後に続く場合だけ対象にし、セリフ中や注記中の同じ語では改行しない。
          breakAfter: /」[はの]?[ \u3000]?(?:radiko|podcast|amazon(?: ?music)?|ラジオクラウド|spotify)/gi,
        },
        { column: '件名', label: '件名', mode: 'normal' },
      ],
    },
    {
      name: 'ラジ父大喜利',
      fields: [
        { column: 'お題', label: 'お題', mode: 'normal' },
        { column: 'ネタ', label: 'ネタ', mode: 'normal' },
        { column: 'お眼鏡賞', label: 'お眼鏡賞', mode: 'badge' },
      ],
    },
    {
      name: 'ワーキャー',
      fields: [
        { column: 'ワーキャー', mode: 'combine', combineGroup: 'wakya' },
        { column: '玄人ウケ', mode: 'combine', combineGroup: 'wakya' },
      ],
    },
    {
      name: '俺にもありました',
      fields: [
        { column: 'ネタ', label: 'ネタ', mode: 'normal' },
        { column: '反応', label: '反応', mode: 'normal' },
        { column: 'おまいは俺か', label: 'おまいは俺か', mode: 'badge' },
      ],
    },
    {
      name: '優しいゴージャスさん',
      fields: [
        { column: 'ネタ', label: 'ネタ', mode: 'normal' },
      ],
    },
    {
      name: 'パンダマン',
      fields: [
        { column: 'ネタ', label: 'ネタ', mode: 'normal' },
      ],
    },
    {
      name: '韻豆',
      fields: [
        { column: 'ネタ', label: 'ネタ', mode: 'normal' },
        { column: 'ガクの予想', label: 'ガクの予想', mode: 'normal' },
        { column: '正解', label: '正解', mode: 'normal' },
      ],
    },
    {
      name: 'ガクにもわかりますか？',
      fields: [
        { column: 'ネタ', label: 'ネタ', mode: 'normal' },
        { column: 'わかりますか？', label: 'わかりますか？', mode: 'normal' },
      ],
    },
    {
      name: 'その他',
      fields: [
        { column: 'テーマ', label: 'テーマ', mode: 'heading' },
        { column: 'メール', label: 'メール', mode: 'normal' },
      ],
    },
    // 「お題」シートは仕様により読み込まない。
  ],
};
