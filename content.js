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
  // X の「もっと見る」リンクのセレクタ候補を順に試す
  const selectors = [
    '[data-testid="tweet-text-show-more-link"]',
    '[data-testid="tweetText"] [role="link"]',
    '[data-testid="tweetText"] a',
  ];

  for (const selector of selectors) {
    const btn = tweetElement.querySelector(selector);
    if (btn) {
      const label = btn.textContent.trim();
      // 「もっと見る」「Show more」のいずれかのテキストを持つ場合のみクリック
      if (label.includes('もっと見る') || label.toLowerCase().includes('show more')) {
        btn.click();
        await sleep(600); // 展開を待つ
        return true;
      }
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
    const tweetTextElement = tweetElement.querySelector('[data-testid="tweetText"]');
    if (tweetTextElement) {
      data.text = tweetTextElement.textContent;
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
});
