// Xのページからブックマーク情報を抽出するコンテンツスクリプト

console.log('X Bookmark Saver: Content script loaded');

// ブックマーク収集のメインロジック
// limitMode : 'count'（件数）| 'days'（日数）| 'all'（制限なし）
// limitCount: 件数モード時の上限件数
// limitDays : 日数モード時の日数（この日数以内のみ取得）
// collectedIds: すでに収集済みのツイートIDのSet（差分収集用）
async function collectBookmarks(limitMode, limitCount, limitDays, includeThreads, collectedIds = new Set()) {
  const bookmarks = [];
  const newIds = []; // 今回新たに収集したID

  // 日付モード用: 何日前までを収集対象とするか
  const dateLimit = limitMode === 'days'
    ? new Date(Date.now() - limitDays * 24 * 60 * 60 * 1000)
    : null;

  // 件数モード用: 上限件数
  const maxCount = limitMode === 'count' ? limitCount : 0;

  // 進捗表示用の想定合計（件数モード時のみ確定値）
  const totalHint = maxCount > 0 ? maxCount : '?';

  try {
    if (!window.location.href.includes('/bookmarks')) {
      throw new Error('ブックマークページで実行してください');
    }

    const modeLabel = limitMode === 'count' ? `最新${limitCount}件`
                    : limitMode === 'days'  ? `直近${limitDays}日以内`
                    : '制限なし';
    console.log(`ブックマーク収集を開始... モード: ${modeLabel} / 収集済み: ${collectedIds.size}件`);

    let lastCount = 0;
    let sameCountIterations = 0;
    const maxSameCount = 5;
    let hitCollected = false;
    let hitDateLimit = false;

    while (true) {
      const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');

      for (const tweetElement of tweetElements) {
        // 件数上限チェック
        if (maxCount > 0 && bookmarks.length >= maxCount) {
          break;
        }

        if (tweetElement.hasAttribute('data-processed')) {
          continue;
        }
        tweetElement.setAttribute('data-processed', 'true');

        const bookmarkData = await extractTweetData(tweetElement);
        if (!bookmarkData || !bookmarkData.url) {
          continue;
        }

        // 日付フィルタ（days モード）
        if (dateLimit && bookmarkData.timestamp) {
          const tweetDate = new Date(bookmarkData.timestamp);
          if (!isNaN(tweetDate) && tweetDate < dateLimit) {
            // XのTLは新しい順なので、ここより下は全て対象外
            hitDateLimit = true;
            break;
          }
        }

        const tweetId = extractTweetId(bookmarkData.url);

        // 差分チェック（収集済みIDをスキップ）
        if (tweetId && collectedIds.has(tweetId)) {
          hitCollected = true;
          continue;
        }

        bookmarks.push(bookmarkData);
        if (tweetId) newIds.push(tweetId);

        if (includeThreads) {
          const thread = await extractThread(tweetElement);
          if (thread && thread.length > 0) {
            bookmarkData.thread = thread;
          }
        }

        chrome.runtime.sendMessage({
          action: 'updateProgress',
          current: bookmarks.length,
          total: totalHint
        });
      }

      // 終了判定
      if (maxCount > 0 && bookmarks.length >= maxCount) {
        console.log(`件数上限（${maxCount}件）に到達`);
        break;
      }
      if (hitDateLimit) {
        console.log(`日付上限（${limitDays}日前）に到達`);
        break;
      }
      if (hitCollected) {
        console.log('収集済みブックマークに到達。差分収集完了');
        break;
      }

      // スクロール終端の検知
      if (bookmarks.length === lastCount) {
        sameCountIterations++;
        if (sameCountIterations >= maxSameCount) {
          console.log('これ以上新しいブックマークが見つかりません');
          break;
        }
      } else {
        sameCountIterations = 0;
        lastCount = bookmarks.length;
      }

      window.scrollTo(0, document.body.scrollHeight);
      await sleep(1500);
    }

    console.log(`収集完了: ${bookmarks.length}件（新規）`);
    return { bookmarks, newIds };

  } catch (error) {
    console.error('ブックマーク収集エラー:', error);
    throw error;
  }
}

// ツイートURLからIDを抽出
function extractTweetId(url) {
  if (!url) return null;
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

// 「さらに表示」ボタンをクリックして全文を展開する
async function expandShowMore(tweetElement) {
  // 1. 専用の testid がある場合（最優先）
  const dedicated = tweetElement.querySelector('[data-testid="tweet-text-show-more-link"]');
  if (dedicated) {
    dedicated.click();
    await sleep(600);
    return true;
  }

  // 2. tweetText 内の全リンク・ロールリンクを走査してテキストで判定
  //    querySelector では最初の1件しか取れないため querySelectorAll を使う
  const candidates = tweetElement.querySelectorAll(
    '[data-testid="tweetText"] a, [data-testid="tweetText"] [role="link"]'
  );
  for (const el of candidates) {
    const label = el.textContent.trim();
    if (label.includes('もっと見る') || label.toLowerCase().includes('show more')) {
      el.click();
      await sleep(600);
      return true;
    }
  }

  return false;
}

// ツイートデータを抽出
async function extractTweetData(tweetElement) {
  try {
    const data = {
      author: {},
      text: '',
      timestamp: '',
      images: [],
      videos: [],
      url: '',
      metrics: {}
    };

    // 作成者情報
    const authorNameElement = tweetElement.querySelector('[data-testid="User-Name"]');
    if (authorNameElement) {
      const nameElement = authorNameElement.querySelector('span');
      const usernameElement = authorNameElement.querySelector('a[role="link"]');

      if (nameElement) {
        data.author.name = nameElement.textContent;
      }
      if (usernameElement) {
        const href = usernameElement.getAttribute('href');
        data.author.username = href ? href.replace('/', '') : '';
      }
    }

    // 「さらに表示」を展開してから本文を取得
    await expandShowMore(tweetElement);

    // ツイート本文を複数のセレクタで試行
    const textSelectors = [
      '[data-testid="tweetText"]',
      '[lang] > span',  // 言語指定されたスパン
      '.css-1jxf684',   // CSSクラス
      '[dir="auto"]'    // 自動方向指定
    ];

    let tweetTextElement = null;
    for (const selector of textSelectors) {
      const el = tweetElement.querySelector(selector);
      if (el && el.textContent.trim().length > 0) {
        tweetTextElement = el;
        break;
      }
    }

    if (tweetTextElement) {
      data.text = tweetTextElement.textContent.trim();
      console.log('ツイート本文取得:', data.text.substring(0, 50) + '...');
    } else {
      console.warn('ツイート本文が見つかりません。article内の全テキストを取得します');
      // フォールバック: article内の全テキストから不要部分を除外
      const allText = tweetElement.textContent || '';
      const lines = allText.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 20 &&
               !trimmed.match(/^[\d,]+$/) &&  // 数字のみの行を除外
               !trimmed.includes('·') &&       // メタデータ区切り
               !trimmed.startsWith('@');       // ユーザー名のみの行
      });
      if (lines.length > 0) {
        data.text = lines[0].trim();
        console.log('フォールバックでツイート本文取得:', data.text.substring(0, 50) + '...');
      }
    }

    // タイムスタンプ
    const timeElement = tweetElement.querySelector('time');
    if (timeElement) {
      data.timestamp = timeElement.getAttribute('datetime') || timeElement.textContent;
    }

    // 画像（URLとして保持）
    const imageElements = tweetElement.querySelectorAll('[data-testid="tweetPhoto"] img');
    imageElements.forEach(img => {
      const src = img.getAttribute('src');
      if (src && !src.includes('profile_images')) {
        data.images.push({
          url: src.split('?')[0],
          alt: img.getAttribute('alt') || ''
        });
      }
    });

    // 動画
    const videoElements = tweetElement.querySelectorAll('video');
    videoElements.forEach(video => {
      const src = video.getAttribute('src');
      if (src) {
        data.videos.push({
          url: src,
          poster: video.getAttribute('poster') || ''
        });
      }
    });

    // ツイートURL（相対パス・絶対パス両対応）
    const linkElement = tweetElement.querySelector('a[href*="/status/"]');
    if (linkElement) {
      const href = linkElement.getAttribute('href');
      data.url = href.startsWith('http') ? href : `https://x.com${href}`;
    }

    // 記事カードのURLを取得（X Notes / Articles）
    // /i/notes/ : X Notes（長文記事）の主要URL形式
    // /i/article : X Articles 旧形式
    // /articles/ : サブパス形式
    const articleSelectors = [
      'a[href*="/i/notes/"]',
      'a[href*="/i/article"]',
      'a[href*="/articles/"]',
      '[data-testid="card.layoutLarge.media"] a',  // カード型記事
      '[data-testid="card.layoutSmall.media"] a',  // 小型カード
      'a[role="link"][href*="x.com/i/"]'           // 汎用
    ];

    let articleLink = null;
    for (const selector of articleSelectors) {
      const el = tweetElement.querySelector(selector);
      if (el) {
        const href = el.getAttribute('href');
        if (href && (href.includes('/i/notes/') || href.includes('/i/article') || href.includes('/articles/'))) {
          articleLink = el;
          break;
        }
      }
    }

    if (articleLink) {
      const href = articleLink.getAttribute('href');
      data.articleUrl = href.startsWith('http') ? href : `https://x.com${href}`;
      console.log('X記事URL検出:', data.articleUrl);

      // 記事カードのタイトルと説明文を取得
      const cardContainer = articleLink.closest('[data-testid^="card.layout"]') || articleLink.closest('[role="link"]');
      if (cardContainer) {
        // タイトル
        const titleEl = cardContainer.querySelector('[role="heading"]') || cardContainer.querySelector('h2, h3');
        if (titleEl) {
          data.articleTitle = titleEl.textContent.trim();
          console.log('記事タイトル:', data.articleTitle);
        }

        // 説明文（カード内の本文）
        const descSelectors = [
          '[data-testid="card.layoutLarge.detail"] > div > span',
          '[data-testid="card.layoutSmall.detail"] > div > span',
          '[role="link"] span[dir="auto"]',
          'div[dir="ltr"] > span'
        ];
        for (const selector of descSelectors) {
          const descEl = cardContainer.querySelector(selector);
          if (descEl && descEl.textContent.trim().length > 20) {
            data.articleSummary = descEl.textContent.trim();
            console.log('記事説明文:', data.articleSummary.substring(0, 50) + '...');
            // textが空の場合、記事説明文をtextとして使用
            if (!data.text || data.text.length < 10) {
              data.text = data.articleSummary;
            }
            break;
          }
        }
      }
    } else {
      // フォールバック: article内の全リンクを検索
      const allLinks = tweetElement.querySelectorAll('a[href]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && (href.includes('/i/notes/') || href.includes('/i/article') || href.includes('/articles/'))) {
          data.articleUrl = href.startsWith('http') ? href : `https://x.com${href}`;
          console.log('X記事URL検出（フォールバック）:', data.articleUrl);
          break;
        }
      }
    }

    // エンゲージメント指標
    const metrics = {
      replies: tweetElement.querySelector('[data-testid="reply"]'),
      retweets: tweetElement.querySelector('[data-testid="retweet"]'),
      likes: tweetElement.querySelector('[data-testid="like"]'),
      views: tweetElement.querySelector('[href$="/analytics"]')
    };

    Object.keys(metrics).forEach(key => {
      if (metrics[key]) {
        const text = metrics[key].textContent;
        const match = text.match(/[\d,]+/);
        if (match) {
          data.metrics[key] = parseInt(match[0].replace(/,/g, ''));
        }
      }
    });

    return data;

  } catch (error) {
    console.error('ツイートデータ抽出エラー:', error);
    return null;
  }
}

// 同一セル内の連続スレッドを抽出
async function extractThread(tweetElement) {
  const thread = [];

  try {
    // cellInnerDiv 内に複数の article が存在する場合、連続スレッドとみなす
    const cell = tweetElement.closest('[data-testid="cellInnerDiv"]');
    if (!cell) return thread;

    const siblings = cell.querySelectorAll('article[data-testid="tweet"]');
    if (siblings.length <= 1) return thread;

    for (const sibling of siblings) {
      if (sibling === tweetElement) continue;
      // スレッド内の他ツイートは data-processed を付けてメイン収集でスキップさせる
      sibling.setAttribute('data-processed', 'true');

      const tweetData = await extractTweetData(sibling);
      if (tweetData) {
        thread.push({
          author: `${tweetData.author.name || ''} (@${tweetData.author.username || ''})`,
          text: tweetData.text,
          timestamp: tweetData.timestamp,
          url: tweetData.url
        });
      }
    }
  } catch (error) {
    console.error('スレッド抽出エラー:', error);
  }

  return thread;
}

// X 記事ページから本文を抽出する
async function extractArticleContent() {
  await sleep(2500); // JS レンダリング待ち（X Notes は重いため長めに設定）

  // タイトル（複数セレクタで試行）
  const title =
    document.querySelector('[data-testid="article-title"]')?.textContent?.trim() ||
    document.querySelector('[data-testid="articleTitle"]')?.textContent?.trim() ||
    document.querySelector('h1')?.textContent?.trim() ||
    document.title.split(' | ')[0].split(' / ')[0] ||
    '';

  // 本文コンテナを複数セレクタで探す（X Notes / Articles 両対応）
  const bodySelectors = [
    '[data-testid="article-body"]',
    '[data-testid="articleBody"]',
    '[data-testid="article-content"]',
    '[data-testid="article"]',
    '[data-testid="noteContent"]',
    '[data-testid="note-body"]',
    '[role="article"]',
    'article',
    'main',
  ];

  let bodyEl = null;
  for (const sel of bodySelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim().length > 100) {
      bodyEl = el;
      break;
    }
  }

  const body = bodyEl
    ? domToMarkdown(bodyEl)
    : Array.from(document.querySelectorAll('p, h1, h2, h3'))
        .map(el => el.textContent.trim())
        .filter(t => t.length > 10)
        .join('\n\n');

  return { title, body };
}

// DOM要素をMarkdownテキストに変換（見出し・段落・リストを保持）
function domToMarkdown(el) {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (/^H[1-6]$/.test(node.nodeName)) {
      const lvl = parseInt(node.nodeName[1]);
      text += '\n\n' + '#'.repeat(lvl) + ' ' + node.textContent.trim();
    } else if (node.nodeName === 'P') {
      const inner = domToMarkdown(node).trim();
      if (inner) text += '\n\n' + inner;
    } else if (node.nodeName === 'LI') {
      text += '\n- ' + node.textContent.trim();
    } else if (node.nodeName === 'BR') {
      text += '\n';
    } else {
      text += domToMarkdown(node);
    }
  }
  return text.trim();
}

// スリープ関数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'collectBookmarks') {
    const collectedIds = new Set(message.collectedIds || []);
    const limitMode  = message.limitMode  || 'all';
    const limitCount = message.limitCount || 50;
    const limitDays  = message.limitDays  || 30;

    collectBookmarks(limitMode, limitCount, limitDays, message.includeThreads, collectedIds)
      .then(({ bookmarks, newIds }) => {
        sendResponse({ success: true, bookmarks, newIds });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // 記事ページから本文を抽出（background.js 経由で呼ばれる）
  if (message.action === 'extractArticleContent') {
    extractArticleContent()
      .then(content => sendResponse({ success: true, content }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
