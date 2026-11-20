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
//   type: 'dynamic-value' … ある列に実際に入っている値を、読み込んだデータから毎回拾い集めてボタンにする
//                    (「すべて」+ 値ごとのボタン。件数の多い順)。選択肢をあらかじめ書かなくてよいので、
//                    スプレッドシート側に新しい値が増えても、コードを直さずそのまま反映される。
//                    { key, type: 'dynamic-value', column: 列名, label: 絞り込みの見出し,
//                      labelOverrides: { 元の値: 表示名, ... },  (任意。値そのものは変えず、表示名だけ変える)
//                      groupEmptyAs: 値 }                       (任意。その列が空欄の投稿を、指定した値と同じ扱いにする)
//
// CONFIG.cornerGroups(任意): 「コーナーで絞り込み」のうち、「期間限定/終了済みコーナー」と「その他」の定義。
//   対象シート(sheetName、通常は「その他」)の、ある列(column、通常は「テーマ」)の値ごとに、
//   名前の付いたコーナーとして選べるようにする。これは「その他」シートの中の値での絞り込みであり、
//   独立したシートではないコーナー専用の仕組み(「ガクナッシュ」のように、専用シートを持たず
//   「その他」の一投稿として扱われているコーナー向け)。
//   limited(期間限定)・ended(終了済み)は、それぞれ { key, label, match? } の配列。
//   match を指定すると、その正規表現に一致する値をまとめて拾う(例: 年ごとに名前が変わる「嘘松大捜査2026」など)。
//   match を省略すると、label と完全に一致する値だけを拾う。
//   limited/ended のどれにも一致しない投稿は、まとめて「その他」(otherLabel)になる。
//   このシートは「現行コーナー」の一覧には出さない(期間限定/終了済み/その他を経由してのみ絞り込む)。
//   注意: 専用シートとして追加されたコーナー(例: 将来追加予定の「竹富島」「日常RTA」)は、
//   ここには書かない。それらは普通に CONFIG.sheets に追加し、「終了済み」であることが画面上でも
//   分かるようにしたい場合は、そのときにあらためて表示方法を検討する(本リストはあくまで
//   「その他」シート内のテーマ値による絞り込み専用)。
//
// フィールドの breakAfter(任意・正規表現):
//   一致した箇所の直後で改行する(一致した文字そのものは表示に残す)。スプレッドシート側の改行は空白として扱う(従来どおり)。
//
// フィールドの breakAt(任意・正規表現):
//   一致した箇所を区切りとして改行する(一致した文字そのものは表示から消える。例: 本文中の「---」)。
//
// フィールドの linkTrailingUrl(任意・true):
//   本文の最後がURLで終わっている場合、そのURLを「この投稿をみる」というリンクに変える
//   (URLの文字そのものは表示に出さない。URLが無い投稿には何もしない)。

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

  // トップページの「お題一覧」。タップすると、その回・このシートだけに絞り込む。
  // 放送回ごとにこの列の値が1つに決まるシートでのみ使う(複数の値がある回は、最初に見つかったものを使う)。
  odaiList: {
    sheetName: 'ラジ父大喜利',
    column: 'お題',
    heading: 'ラジ父大喜利 お題一覧',
  },

  // 「コーナーで絞り込み」の「期間限定/終了済みコーナー」「その他」(「その他」シートのテーマ列が対象)。
  // ふつおた革命・竹富島・日常RTAは、2026年11月時点ではスプレッドシートにまだ無いが、追加予定のため先に用意しておく。
  cornerGroups: {
    sheetName: 'その他',
    column: 'テーマ',
    limited: [
      // 「嘘松大捜査」は年が変わるとテーマの表記が変わる(例: 嘘松大捜査2025 / 嘘松大捜査2026)ため、
      // 年の部分を問わず拾えるよう、前方一致の正規表現で指定する。
      { key: 'uso-matsu', label: '嘘松大捜査', match: /^嘘松大捜査/ },
      { key: 'kono-yo', label: 'この世は壁だらけ' },
      { key: 'gaku-nasshu', label: 'ガクナッシュ' },
      { key: 'kokun-battle', label: '校訓バトル' },
      { key: 'futsuota', label: 'ふつおた革命' },
    ],
    // 「竹富島」「日常RTA」は、「その他」シートのテーマ値ではなく、新しい専用シートとして
    // 追加される予定(2026年11月時点ではまだ無い)。追加されたら、CONFIG.sheets にシートとして
    // 定義する(ここには書かない)。それまでは、終了済みコーナーは0件。
    ended: [],
    otherLabel: 'その他',
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
      displayName: 'パンダマン/デービーバックファイト',
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
      // このシートの絞り込みは、シート選択(現行コーナー)ではなく、CONFIG.cornerGroups 経由で行う
      // (「コーナーで絞り込み」の「期間限定/終了済みコーナー」「その他」)。
      fields: [
        { column: 'テーマ', label: 'テーマ', mode: 'heading' },
        {
          column: 'メール',
          label: 'メール',
          mode: 'normal',
          // 本文中の「---」(ハイフン3つ以上)は、区切りとして使われている。文字は表示せず、そこで改行する。
          breakAt: /-{3,}/,
          // 本文の最後に引用元のURL(X/Twitterの投稿など)が書かれていることがある。「この投稿をみる」のリンクにする。
          // テーマ名(例: 「嘘松大捜査2026」)では判定しない。年が変わって名前が変わっても、そのまま対応できるようにするため。
          linkTrailingUrl: true,
        },
      ],
    },
    // 「お題」シートは仕様により読み込まない。
  ],
};
