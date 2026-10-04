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
// シート設定の subFilters(任意): そのシートを選んだときだけ現れる、追加の絞り込み。
//   type: 'mark'  … 印列(mode: 'badge')に値が入っている行だけを出す、on/offのボタン。
//                    { key, type: 'mark', column: 印列の列名, label: ボタンの表示名 }
//   type: 'value' … ある列の値ごとに選ぶボタン(「すべて」+ options)。
//                    { key, type: 'value', column: 列名, label: 絞り込みの見出し,
//                      options: [{ value: 一致させる値, label: ボタンの表示名 }, ...,
//                                { value: '__other__', label: '...', other: true } ] }
//                    other: true の選択肢は、options に書かれた値のどれとも一致しない、空でない値をまとめて拾う。
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

  // 読み込むシートと表示ルール。この順番が、絞り込みボタンの並びと、投稿の初期表示順(記載順)になる。
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
      name: 'ラジ父大喜利',
      subFilters: [
        { key: 'mark', type: 'mark', column: 'お眼鏡賞', label: 'お眼鏡賞のみ表示' },
      ],
      fields: [
        { column: 'お題', label: 'お題', mode: 'normal' },
        { column: 'ネタ', label: 'ネタ', mode: 'normal' },
        { column: 'お眼鏡賞', label: 'お眼鏡賞', mode: 'badge' },
      ],
    },
    {
      name: 'ワーキャー',
      displayName: 'ワーキャーのコーナー',
      fields: [
        { column: 'ワーキャー', mode: 'combine', combineGroup: 'wakya' },
        { column: '玄人ウケ', mode: 'combine', combineGroup: 'wakya' },
      ],
    },
    {
      name: '俺にもありました',
      subFilters: [
        { key: 'mark', type: 'mark', column: 'おまいは俺か', label: 'おまいは俺かのみ表示' },
      ],
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
      displayName: 'みんなで！韻豆',
      subFilters: [
        {
          key: 'answer',
          type: 'value',
          column: '正解',
          label: '正解',
          options: [
            { value: '韻豆', label: '韻豆' },
            { value: '偽韻豆', label: '偽韻豆' },
            { value: '__other__', label: 'その他', other: true },
          ],
        },
      ],
      fields: [
        { column: 'ネタ', label: 'ネタ', mode: 'normal' },
        { column: 'ガクの予想', label: 'ガクの予想', mode: 'normal' },
        { column: '正解', label: '正解', mode: 'normal' },
      ],
    },
    {
      name: 'ガクにもわかりますか？',
      subFilters: [
        {
          key: 'wakaru',
          type: 'value',
          column: 'わかりますか？',
          label: 'わかりますか？',
          options: [
            { value: 'わかる', label: 'わかる' },
            { value: 'わからない', label: 'わからない' },
          ],
        },
      ],
      fields: [
        { column: 'ネタ', label: 'ネタ', mode: 'normal' },
        { column: 'わかりますか？', label: 'わかりますか？', mode: 'normal' },
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
      name: 'その他',
      fields: [
        { column: 'テーマ', label: 'テーマ', mode: 'heading' },
        { column: 'メール', label: 'メール', mode: 'normal' },
      ],
    },
    // 「お題」シートは仕様により読み込まない。
  ],
};
