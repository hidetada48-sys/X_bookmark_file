// Xのページからブックマーク情報を抽出するコンテンツスクリプト

console.log('X Bookmark Saver: Content script loaded');

// ブックマーク収集のメインロジック
// collectedIds: すでに収集済みのツイートURLのSet（差分収集用）
async function collectBookmarks(maxBookmarks, includeThreads, collectedIds = new Set()) {
  const bookmarks = [];
  const newIds = []; // 今回新たに収集したID

  try {
    // ブックマークページかチェック
    if (!window.location.href.includes('/bookmarks')) {
      throw new Error('ブックマークページで実行してください');
    }

    console.log(`ブックマーク収集を開始... (収集済み: ${collectedIds.size}件)`);

    // スクロールしながらツイートを収集
    let lastCount = 0;
    let sameCountIterations = 0;
    const maxSameCount = 5; // 同じ数が続いたら終了
    let hitCollected = false; // 収集済みに達したフラグ

    while (true) {
      // ツイート要素を取得
      const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');

      // 各ツイートから情報を抽出
      for (const tweetElement of tweetElements) {
        if (maxBookmarks > 0 && bookmarks.length >= maxBookmarks) {
          break;
        }

        // すでに処理済みかチェック（今回のセッション内の重複排除）
        if (tweetElement.hasAttribute('data-processed')) {
          continue;
        }

        tweetElement.setAttribute('data-processed', 'true');

        const bookmarkData = extractTweetData(tweetElement);
        if (!bookmarkData || !bookmarkData.url) {
          continue;
        }

        // ツイートIDをURLから抽出（差分判定キー）
        const tweetId = extractTweetId(bookmarkData.url);

        // 収集済みIDに含まれる場合はスキップ
        if (tweetId && collectedIds.has(tweetId)) {
          hitCollected = true;
          continue;
        }

        bookmarks.push(bookmarkData);
        if (tweetId) newIds.push(tweetId);

        // スレッドの取得
        if (includeThreads) {
          const thread = await extractThread(tweetElement);
          if (thread && thread.length > 0) {
            bookmarkData.thread = thread;
          }
        }

        // 進捗を通知
        chrome.runtime.sendMessage({
          action: 'updateProgress',
          current: bookmarks.length,
          total: maxBookmarks || '?'
        });
      }

      // 目標数に達したら終了
      if (maxBookmarks > 0 && bookmarks.length >= maxBookmarks) {
        break;
      }

      // 収集済みのツイートに達した場合は終了（新着は全て収集完了）
      if (hitCollected) {
        console.log('収集済みブックマークに到達。差分収集完了');
        break;
      }

      // 新しいツイートが読み込まれたかチェック
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

      // スクロールして次のツイートを読み込み
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(1500); // 読み込み待機
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

// ツイートデータを抽出
function extractTweetData(tweetElement) {
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

    // ツイート本文
    const tweetTextElement = tweetElement.querySelector('[data-testid="tweetText"]');
    if (tweetTextElement) {
      data.text = tweetTextElement.textContent;
    }

    // タイムスタンプ
    const timeElement = tweetElement.querySelector('time');
    if (timeElement) {
      data.timestamp = timeElement.getAttribute('datetime') || timeElement.textContent;
    }

    // 画像
    const imageElements = tweetElement.querySelectorAll('[data-testid="tweetPhoto"] img');
    imageElements.forEach(img => {
      const src = img.getAttribute('src');
      if (src && !src.includes('profile_images')) {
        data.images.push({
          url: src.split('?')[0], // クエリパラメータを除去
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

    // ツイートURL
    const linkElement = tweetElement.querySelector('a[href*="/status/"]');
    if (linkElement) {
      const href = linkElement.getAttribute('href');
      data.url = `https://x.com${href}`;
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
        const match = text.match(/\d+/);
        if (match) {
          data.metrics[key] = parseInt(match[0]);
        }
      }
    });

    return data;

  } catch (error) {
    console.error('ツイートデータ抽出エラー:', error);
    return null;
  }
}

// スレッドを抽出（簡易版）
async function extractThread(tweetElement) {
  const thread = [];

  try {
    // 「このスレッドを表示」ボタンを探す
    const showThreadButton = tweetElement.querySelector('[role="button"]');
    if (showThreadButton && showThreadButton.textContent.includes('このスレッド')) {
      // ボタンをクリックしてスレッドを展開
      // 注: 実際の実装ではツイート詳細ページを開く必要がある場合があります

      // 現在表示されている関連ツイートを取得
      const parentElement = tweetElement.closest('[data-testid="cellInnerDiv"]');
      if (parentElement) {
        const threadTweets = parentElement.querySelectorAll('article[data-testid="tweet"]');
        threadTweets.forEach(tweet => {
          if (tweet !== tweetElement) {
            const tweetData = extractTweetData(tweet);
            if (tweetData) {
              thread.push({
                author: `${tweetData.author.name} (@${tweetData.author.username})`,
                text: tweetData.text,
                timestamp: tweetData.timestamp
              });
            }
          }
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
    // 収集済みIDをSetに変換して渡す
    const collectedIds = new Set(message.collectedIds || []);

    collectBookmarks(message.maxBookmarks, message.includeThreads, collectedIds)
      .then(({ bookmarks, newIds }) => {
        sendResponse({ success: true, bookmarks, newIds });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // 非同期レスポンスを示す
  }
});
