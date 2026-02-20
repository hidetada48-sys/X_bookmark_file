// ポップアップUIのロジック
let collectedBookmarks = [];
let isAuthenticated = false;

// DOM要素の取得
const elements = {
  status: document.getElementById('status'),
  collectButton: document.getElementById('collectButton'),
  exportButton: document.getElementById('exportButton'),
  limitMode: document.getElementById('limitMode'),
  limitCount: document.getElementById('limitCount'),
  limitDays: document.getElementById('limitDays'),
  limitCountGroup: document.getElementById('limitCountGroup'),
  limitDaysGroup: document.getElementById('limitDaysGroup'),
  format: document.getElementById('format'),
  includeImages: document.getElementById('includeImages'),
  includeThreads: document.getElementById('includeThreads'),
  progressContainer: document.getElementById('progressContainer'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  log: document.getElementById('log')
};

// 収集範囲セレクト変更で対応入力欄を切り替え
elements.limitMode.addEventListener('change', () => {
  const mode = elements.limitMode.value;
  elements.limitCountGroup.style.display = mode === 'count' ? 'block' : 'none';
  elements.limitDaysGroup.style.display  = mode === 'days'  ? 'block' : 'none';
});

// ログ出力
function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  elements.log.appendChild(entry);
  elements.log.scrollTop = elements.log.scrollHeight;
}

// ステータス更新
function updateStatus(message, type = 'info') {
  elements.status.textContent = message;
  elements.status.className = 'status';
  if (type === 'error') {
    elements.status.classList.add('error');
  } else if (type === 'warning') {
    elements.status.classList.add('warning');
  }
}

// プログレス更新
function updateProgress(current, total) {
  const percent = total > 0 ? (current / total) * 100 : 0;
  elements.progressFill.style.width = `${percent}%`;
  elements.progressText.textContent = `${current} / ${total}`;
}

// ブックマーク収集
elements.collectButton.addEventListener('click', async () => {
  try {
    addLog('ブックマークの収集を開始...', 'info');
    elements.collectButton.disabled = true;
    elements.progressContainer.style.display = 'block';
    updateProgress(0, 0);

    const limitMode  = elements.limitMode.value;
    const limitCount = parseInt(elements.limitCount.value) || 50;
    const limitDays  = parseInt(elements.limitDays.value)  || 30;
    const includeThreads = elements.includeThreads.checked;

    // コンテンツスクリプトにメッセージ送信
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url.includes('/bookmarks')) {
      throw new Error('x.com/bookmarks を開いてから実行してください');
    }

    const modeLabel = limitMode === 'count' ? `最新${limitCount}件`
                    : limitMode === 'days'  ? `直近${limitDays}日以内`
                    : '制限なし';
    updateStatus(`収集中... （${modeLabel}）`, 'warning');

    // 収集済みIDを取得して差分収集を実行
    const collectedIds = window._collectedIds || [];
    addLog(`収集済み: ${collectedIds.length}件 / 範囲: ${modeLabel}`, 'info');

    // コンテンツスクリプトにブックマーク収集を指示
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        action: 'collectBookmarks',
        limitMode,
        limitCount,
        limitDays,
        includeThreads,
        collectedIds
      });
    } catch (e) {
      if (e.message && e.message.includes('Could not establish connection')) {
        throw new Error(
          'コンテンツスクリプトに接続できません。\n' +
          'ページを再読み込み（F5）してからもう一度お試しください。'
        );
      }
      throw e;
    }

    if (response.success) {
      collectedBookmarks = response.bookmarks;
      const newIds = response.newIds || [];

      if (collectedBookmarks.length === 0) {
        addLog('未収集のブックマークはありません', 'info');
        updateStatus('新着なし（全て収集済み）');
      } else {
        addLog(`${collectedBookmarks.length}件の新規ブックマークを収集しました`, 'success');
        updateProgress(collectedBookmarks.length, collectedBookmarks.length);

        // 新しいIDをbackground.jsに保存
        const saveResponse = await chrome.runtime.sendMessage({
          action: 'saveCollectedIds',
          newIds
        });
        if (saveResponse.success) {
          addLog(`収集済み合計: ${saveResponse.total}件`, 'info');
          window._collectedIds = [...collectedIds, ...newIds];
        }

        // X 記事の本文を取得
        const articlesWithUrl = collectedBookmarks.filter(b => b.articleUrl);
        if (articlesWithUrl.length > 0) {
          addLog(`X 記事を ${articlesWithUrl.length}件 検出。本文を取得中...`, 'info');
          for (let i = 0; i < articlesWithUrl.length; i++) {
            const bm = articlesWithUrl[i];
            updateStatus(`記事本文を取得中... (${i + 1}/${articlesWithUrl.length}件)`, 'warning');
            addLog(`記事取得中: ${bm.articleUrl}`, 'info');
            try {
              const artRes = await chrome.runtime.sendMessage({
                action: 'fetchArticleContent',
                url: bm.articleUrl
              });
              if (artRes.success && artRes.content) {
                bm.articleContent = artRes.content;
                addLog(`記事本文取得完了: ${artRes.content.title || '(タイトルなし)'}`, 'success');
              } else {
                addLog(`記事本文取得失敗: ${artRes.error || '不明なエラー'}`, 'error');
              }
            } catch (e) {
              addLog(`記事本文取得エラー: ${e.message}`, 'error');
            }
          }
        }

        updateStatus(`新規 ${collectedBookmarks.length}件収集完了`);
        elements.exportButton.disabled = false;
      }
    } else {
      throw new Error(response.error || '収集に失敗しました');
    }
  } catch (error) {
    addLog(`収集エラー: ${error.message}`, 'error');
    updateStatus('収集失敗', 'error');
  } finally {
    elements.collectButton.disabled = false;
  }
});

// エクスポート（ローカルダウンロード：1件1ファイル）
elements.exportButton.addEventListener('click', async () => {
  try {
    if (collectedBookmarks.length === 0) {
      throw new Error('収集したブックマークがありません');
    }

    addLog('ダウンロードを開始...', 'info');
    elements.exportButton.disabled = true;
    updateStatus('ダウンロード中...', 'warning');

    const format = elements.format.value;

    // 1件ずつダウンロード
    for (let i = 0; i < collectedBookmarks.length; i++) {
      const bookmark = collectedBookmarks[i];
      const fileContent = formatSingleBookmark(bookmark, format);
      const filename = makeFilename(bookmark, i + 1, format);

      updateStatus(`ダウンロード中... (${i + 1}/${collectedBookmarks.length}件)`, 'warning');

      // ローカルダウンロード
      downloadFile(filename, fileContent, getMimeType(format));

      // ブラウザの処理待ち（連続ダウンロードの間隔）
      await sleep(100);

      addLog(`ダウンロード: ${filename}`, 'success');
    }

    updateStatus(`${collectedBookmarks.length}件 ダウンロード完了`);
    addLog(`ダウンロードフォルダを確認してください`, 'info');

  } catch (error) {
    addLog(`ダウンロードエラー: ${error.message}`, 'error');
    updateStatus('ダウンロード失敗', 'error');
  } finally {
    elements.exportButton.disabled = false;
  }
});

// 1件のブックマークをフォーマット
function formatSingleBookmark(bookmark, format) {
  if (format === 'markdown') return formatSingleAsMarkdown(bookmark);
  if (format === 'json') return JSON.stringify(bookmark, null, 2);
  return formatSingleAsText(bookmark);
}

// 1件用ファイル名を生成（例: 001_johndoe_2026-01-15.md）
function makeFilename(bookmark, index, format) {
  const ext = format === 'markdown' ? 'md' : format;
  const username = (bookmark.author.username || 'unknown')
    .replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30);
  const date = bookmark.timestamp
    ? new Date(bookmark.timestamp).toISOString().split('T')[0]
    : 'no-date';
  const idx = String(index).padStart(3, '0');
  return `${idx}_${username}_${date}.${ext}`;
}

// 1件を Markdown 形式でフォーマット
function formatSingleAsMarkdown(bookmark) {
  let md = `# ${bookmark.author.name || ''}（@${bookmark.author.username || ''}）\n\n`;

  const meta = [];
  if (bookmark.timestamp) {
    const d = new Date(bookmark.timestamp);
    meta.push(`投稿日時: ${isNaN(d) ? bookmark.timestamp : d.toLocaleString('ja-JP')}`);
  }
  if (bookmark.url) meta.push(`URL: ${bookmark.url}`);

  const m = bookmark.metrics || {};
  const metricParts = [];
  if (m.replies  != null) metricParts.push(`返信 ${m.replies}`);
  if (m.retweets != null) metricParts.push(`RT ${m.retweets}`);
  if (m.likes    != null) metricParts.push(`いいね ${m.likes}`);
  if (m.views    != null) metricParts.push(`閲覧 ${m.views}`);
  if (metricParts.length > 0) meta.push(metricParts.join(' / '));
  meta.forEach(line => { md += `- ${line}\n`; });
  md += '\n';

  if (bookmark.text) md += `${bookmark.text}\n\n`;

  // X 記事（カード情報）
  if (bookmark.articleTitle || bookmark.articleSummary || bookmark.articleUrl) {
    md += `## X記事\n\n`;
    if (bookmark.articleTitle) md += `**タイトル**: ${bookmark.articleTitle}\n\n`;
    if (bookmark.articleSummary) md += `**要約**: ${bookmark.articleSummary}\n\n`;
    if (bookmark.articleUrl) md += `[記事を読む](${bookmark.articleUrl})\n\n`;
  }

  // X 記事本文（fetchArticleContentで取得した全文）
  if (bookmark.articleContent) {
    const { title, body } = bookmark.articleContent;
    md += `## 記事全文: ${title || '(タイトルなし)'}\n\n${body}\n\n`;
  }

  // スレッド
  if (bookmark.thread && bookmark.thread.length > 0) {
    md += `## スレッド（${bookmark.thread.length}件）\n\n`;
    bookmark.thread.forEach(tweet => {
      md += `> **${tweet.author}**`;
      if (tweet.url) md += ` — [リンク](${tweet.url})`;
      md += `\n>\n> ${tweet.text}\n\n`;
    });
  }

  if (bookmark.url) md += `[元の投稿を見る](${bookmark.url})\n`;

  return md;
}

// 1件をテキスト形式でフォーマット
function formatSingleAsText(bookmark) {
  let text = `${bookmark.author.name || ''} (@${bookmark.author.username || ''})\n`;
  if (bookmark.timestamp) text += `投稿日時: ${bookmark.timestamp}\n`;
  if (bookmark.url) text += `URL: ${bookmark.url}\n`;
  text += '\n';
  if (bookmark.text) text += `${bookmark.text}\n\n`;

  if (bookmark.articleTitle || bookmark.articleSummary || bookmark.articleUrl) {
    text += `[X記事]\n`;
    if (bookmark.articleTitle) text += `タイトル: ${bookmark.articleTitle}\n`;
    if (bookmark.articleSummary) text += `要約: ${bookmark.articleSummary}\n`;
    if (bookmark.articleUrl) text += `URL: ${bookmark.articleUrl}\n`;
    text += `\n`;
  }

  if (bookmark.articleContent) {
    const { title, body } = bookmark.articleContent;
    text += `[記事全文: ${title || ''}]\n${body}\n\n`;
  }

  if (bookmark.thread && bookmark.thread.length > 0) {
    text += `スレッド: ${bookmark.thread.length}件\n`;
    bookmark.thread.forEach((tweet, i) => {
      text += `  [${i + 1}] ${tweet.author}: ${tweet.text}\n`;
    });
  }

  return text;
}

// ブックマークをフォーマット（一括出力用、内部利用）
function formatBookmarks(bookmarks, format) {
  if (format === 'markdown') {
    return formatAsMarkdown(bookmarks);
  } else if (format === 'json') {
    return JSON.stringify(bookmarks, null, 2);
  } else {
    return formatAsText(bookmarks, false);
  }
}

// Markdown形式
function formatAsMarkdown(bookmarks) {
  let md = `# X Bookmarks Export\n\n`;
  md += `エクスポート日時: ${new Date().toLocaleString('ja-JP')}\n`;
  md += `総数: ${bookmarks.length}件\n\n`;
  md += `---\n\n`;

  bookmarks.forEach((bookmark, index) => {
    // ヘッダー
    md += `## ${index + 1}. ${bookmark.author.name || ''}（@${bookmark.author.username || ''}）\n\n`;

    // メタデータをまとめて表示
    const meta = [];
    if (bookmark.timestamp) {
      const d = new Date(bookmark.timestamp);
      meta.push(`投稿日時: ${isNaN(d) ? bookmark.timestamp : d.toLocaleString('ja-JP')}`);
    }
    if (bookmark.url) {
      meta.push(`URL: ${bookmark.url}`);
    }
    const m = bookmark.metrics || {};
    const metricParts = [];
    if (m.replies  != null) metricParts.push(`返信 ${m.replies}`);
    if (m.retweets != null) metricParts.push(`RT ${m.retweets}`);
    if (m.likes    != null) metricParts.push(`いいね ${m.likes}`);
    if (m.views    != null) metricParts.push(`閲覧 ${m.views}`);
    if (metricParts.length > 0) meta.push(metricParts.join(' / '));

    meta.forEach(line => { md += `- ${line}\n`; });
    md += `\n`;

    // 本文
    if (bookmark.text) {
      md += `${bookmark.text}\n\n`;
    }

    // X 記事（カード情報）
    if (bookmark.articleTitle || bookmark.articleSummary || bookmark.articleUrl) {
      md += `### X記事\n\n`;
      if (bookmark.articleTitle) md += `**タイトル**: ${bookmark.articleTitle}\n\n`;
      if (bookmark.articleSummary) md += `**要約**: ${bookmark.articleSummary}\n\n`;
      if (bookmark.articleUrl) md += `[記事を読む](${bookmark.articleUrl})\n\n`;
    }

    // X 記事本文（fetchArticleContentで取得した全文）
    if (bookmark.articleContent) {
      const { title, body } = bookmark.articleContent;
      md += `### 記事全文: ${title || '(タイトルなし)'}\n\n${body}\n\n`;
    }

    // スレッド
    if (bookmark.thread && bookmark.thread.length > 0) {
      md += `### スレッド（${bookmark.thread.length}件）\n\n`;
      bookmark.thread.forEach((tweet) => {
        md += `> **${tweet.author}**`;
        if (tweet.url) md += ` — [リンク](${tweet.url})`;
        md += `\n>\n> ${tweet.text}\n\n`;
      });
    }

    // 元投稿リンク
    if (bookmark.url) {
      md += `[元の投稿を見る](${bookmark.url})\n\n`;
    }

    md += `---\n\n`;
  });

  return md;
}

// テキスト形式
function formatAsText(bookmarks, includeImages) {
  let text = `X Bookmarks Export\n`;
  text += `エクスポート日時: ${new Date().toLocaleString('ja-JP')}\n`;
  text += `総数: ${bookmarks.length}件\n\n`;
  text += `${'='.repeat(80)}\n\n`;

  bookmarks.forEach((bookmark, index) => {
    text += `[${index + 1}] ${bookmark.author.name} (@${bookmark.author.username})\n`;
    text += `投稿日時: ${bookmark.timestamp}\n\n`;

    if (bookmark.text) {
      text += `${bookmark.text}\n\n`;
    }

    if (bookmark.articleTitle || bookmark.articleSummary || bookmark.articleUrl) {
      text += `[X記事]\n`;
      if (bookmark.articleTitle) text += `タイトル: ${bookmark.articleTitle}\n`;
      if (bookmark.articleSummary) text += `要約: ${bookmark.articleSummary}\n`;
      if (bookmark.articleUrl) text += `URL: ${bookmark.articleUrl}\n`;
      text += `\n`;
    }

    if (bookmark.articleContent) {
      const { title, body } = bookmark.articleContent;
      text += `[記事全文: ${title || ''}]\n${body}\n\n`;
    }

    if (includeImages && bookmark.images && bookmark.images.length > 0) {
      text += `画像: ${bookmark.images.length}枚\n`;
      bookmark.images.forEach((img, i) => {
        text += `  - ${img.url}\n`;
      });
      text += `\n`;
    }

    if (bookmark.thread && bookmark.thread.length > 0) {
      text += `スレッド: ${bookmark.thread.length}件\n`;
      bookmark.thread.forEach((tweet, i) => {
        text += `  [${i + 1}] ${tweet.author}: ${tweet.text}\n`;
      });
      text += `\n`;
    }

    if (bookmark.url) {
      text += `URL: ${bookmark.url}\n`;
    }

    text += `\n${'-'.repeat(80)}\n\n`;
  });

  return text;
}

// MIMEタイプ取得
function getMimeType(format) {
  const mimeTypes = {
    'markdown': 'text/markdown',
    'json': 'application/json',
    'text': 'text/plain'
  };
  return mimeTypes[format] || 'text/plain';
}

// 初期化時に収集済み件数をチェック
async function initialize() {
  // 収集済みIDの件数を表示
  const response = await chrome.runtime.sendMessage({ action: 'getCollectedIds' });
  if (response.success) {
    const count = response.ids.length;
    if (count > 0) {
      updateStatus(`収集済み: ${count}件 / 未収集分のみ取得します`);
      addLog(`収集済みブックマーク: ${count}件`, 'info');
    } else {
      updateStatus('準備完了 - ブックマークページで「収集」を実行してください');
    }
    // 件数をグローバルに保持
    window._collectedIds = response.ids;
  }
}

initialize();

// 収集履歴リセット
document.getElementById('resetButton').addEventListener('click', async () => {
  if (!confirm('収集済み履歴をリセットします。次回収集時に全ブックマークを再取得します。よろしいですか？')) {
    return;
  }
  const response = await chrome.runtime.sendMessage({ action: 'resetCollectedIds' });
  if (response.success) {
    window._collectedIds = [];
    addLog('収集履歴をリセットしました', 'info');
    updateStatus('初回収集 - 全ブックマークを取得します');
  }
});

// メッセージリスナー（進捗更新用）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateProgress') {
    updateProgress(message.current, message.total);
    addLog(`進捗: ${message.current}/${message.total}`, 'info');
  }
});

// ファイルダウンロード関数
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// スリープ関数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
