// ポップアップUIのロジック
let collectedBookmarks = [];
let isAuthenticated = false;

// DOM要素の取得
const elements = {
  status: document.getElementById('status'),
  authButton: document.getElementById('authButton'),
  authStatus: document.getElementById('authStatus'),
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

// Google認証
elements.authButton.addEventListener('click', async () => {
  try {
    addLog('Google認証を開始...', 'info');
    elements.authButton.disabled = true;

    const response = await chrome.runtime.sendMessage({
      action: 'authenticate'
    });

    if (response.success) {
      isAuthenticated = true;
      elements.authStatus.textContent = '✓ 認証済み';
      elements.authButton.textContent = '再認証';
      elements.collectButton.disabled = false;
      addLog('Google認証に成功しました', 'success');
      updateStatus('認証済み');
    } else {
      throw new Error(response.error || '認証に失敗しました');
    }
  } catch (error) {
    addLog(`認証エラー: ${error.message}`, 'error');
    updateStatus('認証失敗', 'error');
  } finally {
    elements.authButton.disabled = false;
  }
});

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

    if (!tab.url.includes('x.com') && !tab.url.includes('twitter.com')) {
      throw new Error('X/Twitterのページで実行してください');
    }

    const modeLabel = limitMode === 'count' ? `最新${limitCount}件`
                    : limitMode === 'days'  ? `直近${limitDays}日以内`
                    : '制限なし';
    updateStatus(`収集中... （${modeLabel}）`, 'warning');

    // 収集済みIDを取得して差分収集を実行
    const collectedIds = window._collectedIds || [];
    addLog(`収集済み: ${collectedIds.length}件 / 範囲: ${modeLabel}`, 'info');

    // コンテンツスクリプトにブックマーク収集を指示
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'collectBookmarks',
      limitMode,
      limitCount,
      limitDays,
      includeThreads,
      collectedIds
    });

    if (response.success) {
      collectedBookmarks = response.bookmarks;
      const newIds = response.newIds || [];

      if (collectedBookmarks.length === 0) {
        addLog('未収集のブックマークはありません', 'info');
        updateStatus('新着なし（全て収集済み）');
      } else {
        addLog(`${collectedBookmarks.length}件の新規ブックマークを収集しました`, 'success');
        updateStatus(`新規 ${collectedBookmarks.length}件収集完了`);
        elements.exportButton.disabled = false;
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

// エクスポート
elements.exportButton.addEventListener('click', async () => {
  try {
    if (collectedBookmarks.length === 0) {
      throw new Error('収集したブックマークがありません');
    }

    addLog('エクスポートを開始...', 'info');
    elements.exportButton.disabled = true;
    updateStatus('エクスポート中...', 'warning');

    const format = elements.format.value;
    const includeImages = elements.includeImages.checked;

    // データを整形
    const formattedData = formatBookmarks(collectedBookmarks, format, includeImages);

    // ファイル名の生成
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const extension = format === 'markdown' ? 'md' : format;
    const filename = `x-bookmarks-${timestamp}.${extension}`;

    // Google Driveに保存
    const response = await chrome.runtime.sendMessage({
      action: 'saveToDrive',
      filename,
      content: formattedData,
      mimeType: getMimeType(format)
    });

    if (response.success) {
      addLog(`Google Driveに保存しました: ${filename}`, 'success');
      updateStatus('エクスポート完了');

      // ファイルIDがある場合はリンクを表示
      if (response.fileId) {
        const link = `https://drive.google.com/file/d/${response.fileId}/view`;
        addLog(`ファイルURL: ${link}`, 'info');
      }
    } else {
      throw new Error(response.error || '保存に失敗しました');
    }
  } catch (error) {
    addLog(`エクスポートエラー: ${error.message}`, 'error');
    updateStatus('エクスポート失敗', 'error');
  } finally {
    elements.exportButton.disabled = false;
  }
});

// ブックマークをフォーマット
function formatBookmarks(bookmarks, format, includeImages) {
  if (format === 'markdown') {
    return formatAsMarkdown(bookmarks, includeImages);
  } else if (format === 'json') {
    return JSON.stringify(bookmarks, null, 2);
  } else {
    return formatAsText(bookmarks, includeImages);
  }
}

// Markdown形式
function formatAsMarkdown(bookmarks, includeImages) {
  let md = `# X Bookmarks Export\n\n`;
  md += `エクスポート日時: ${new Date().toLocaleString('ja-JP')}\n`;
  md += `総数: ${bookmarks.length}件\n\n`;
  md += `---\n\n`;

  bookmarks.forEach((bookmark, index) => {
    md += `## ${index + 1}. ${bookmark.author.name} (@${bookmark.author.username})\n\n`;
    md += `**投稿日時**: ${bookmark.timestamp}\n\n`;

    if (bookmark.text) {
      md += `${bookmark.text}\n\n`;
    }

    if (includeImages && bookmark.images && bookmark.images.length > 0) {
      md += `### 画像\n\n`;
      bookmark.images.forEach((img, i) => {
        md += `![画像${i + 1}](${img.url})\n\n`;
      });
    }

    if (bookmark.thread && bookmark.thread.length > 0) {
      md += `### スレッド (${bookmark.thread.length}件)\n\n`;
      bookmark.thread.forEach((tweet, i) => {
        md += `#### ${i + 1}. ${tweet.author}\n\n`;
        md += `${tweet.text}\n\n`;
      });
    }

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

// 初期化時に認証状態と収集済み件数をチェック
async function initialize() {
  // 認証状態チェック
  const stored = await chrome.storage.local.get(['accessToken']);
  if (stored.accessToken) {
    isAuthenticated = true;
    elements.authStatus.textContent = '✓ 認証済み';
    elements.collectButton.disabled = false;
  }

  // 収集済みIDの件数を表示
  const response = await chrome.runtime.sendMessage({ action: 'getCollectedIds' });
  if (response.success) {
    const count = response.ids.length;
    if (count > 0) {
      updateStatus(`収集済み: ${count}件 / 未収集分のみ取得します`);
      addLog(`収集済みブックマーク: ${count}件`, 'info');
    } else {
      updateStatus('初回収集 - 全ブックマークを取得します');
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
