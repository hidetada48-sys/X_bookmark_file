// バックグラウンドスクリプト（Service Worker）
// Google Drive API連携とメッセージハンドリング

console.log('X Bookmark Saver: Background script loaded');

// Google OAuth認証
async function authenticate() {
  try {
    // インタラクティブモードでトークンを取得
    const token = await chrome.identity.getAuthToken({ interactive: true });

    if (!token) {
      throw new Error('認証トークンの取得に失敗しました');
    }

    // トークンを保存
    await chrome.storage.local.set({ accessToken: token });

    console.log('Google認証成功');
    return token;

  } catch (error) {
    console.error('認証エラー:', error);

    // ユーザーがキャンセルした場合
    if (error.message.includes('canceled') || error.message.includes('cancelled')) {
      throw new Error('認証がキャンセルされました');
    }

    // その他のエラー
    throw new Error(`認証に失敗しました: ${error.message}`);
  }
}

// 保存済みトークンを取得
async function getStoredToken() {
  const result = await chrome.storage.local.get(['accessToken']);
  return result.accessToken;
}

// トークンをリフレッシュ
async function refreshToken() {
  try {
    // 古いトークンを削除
    await chrome.identity.removeCachedAuthToken({
      token: await getStoredToken()
    });

    // 新しいトークンを取得
    return await authenticate();

  } catch (error) {
    console.error('トークンリフレッシュエラー:', error);
    throw error;
  }
}

// マルチパートリクエストボディを作成
function createMultipartBody(metadata, content, boundary) {
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadataStr = JSON.stringify(metadata);

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadataStr +
    delimiter +
    `Content-Type: ${metadata.mimeType}\r\n\r\n` +
    content +
    closeDelimiter;

  return body;
}

// Google Driveにファイルをアップロード
async function uploadToDrive(filename, content, mimeType) {
  try {
    let accessToken = await getStoredToken();

    if (!accessToken) {
      throw new Error('認証が必要です。先にGoogle認証を行ってください');
    }

    // メタデータ
    const metadata = {
      name: filename,
      mimeType: mimeType
    };

    // マルチパートボディを作成
    const boundary = '-------314159265358979323846264';
    const body = createMultipartBody(metadata, content, boundary);

    // Drive APIにアップロード
    let response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: body
      }
    );

    // 401エラー（トークン無効）の場合、トークンをリフレッシュして再試行
    if (response.status === 401) {
      console.log('トークンが無効です。リフレッシュして再試行...');
      accessToken = await refreshToken();

      response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body: body
        }
      );
    }

    // レスポンスをチェック
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Drive API エラー:', errorText);
      throw new Error(`ファイルのアップロードに失敗しました: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log('ファイルアップロード成功:', result);

    return {
      fileId: result.id,
      fileName: result.name,
      webViewLink: `https://drive.google.com/file/d/${result.id}/view`
    };

  } catch (error) {
    console.error('アップロードエラー:', error);
    throw error;
  }
}

// メッセージハンドリング
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('メッセージ受信:', message);

  // Google認証
  if (message.action === 'authenticate') {
    authenticate()
      .then(token => {
        sendResponse({
          success: true,
          token: token
        });
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error.message
        });
      });

    return true; // 非同期レスポンスを有効化
  }

  // Google Driveに保存
  if (message.action === 'saveToDrive') {
    const { filename, content, mimeType } = message;

    if (!filename || !content || !mimeType) {
      sendResponse({
        success: false,
        error: 'ファイル名、コンテンツ、MIMEタイプが必要です'
      });
      return true;
    }

    uploadToDrive(filename, content, mimeType)
      .then(result => {
        sendResponse({
          success: true,
          fileId: result.fileId,
          fileName: result.fileName,
          webViewLink: result.webViewLink
        });
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error.message
        });
      });

    return true; // 非同期レスポンスを有効化
  }

  // 収集済みIDを取得（ポップアップ起動時に呼ばれる）
  if (message.action === 'getCollectedIds') {
    getCollectedIds()
      .then(ids => sendResponse({ success: true, ids }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 収集済みIDを追記保存（収集完了後に呼ばれる）
  if (message.action === 'saveCollectedIds') {
    saveCollectedIds(message.newIds || [])
      .then(total => sendResponse({ success: true, total }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 収集履歴をリセット
  if (message.action === 'resetCollectedIds') {
    resetCollectedIds()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 進捗更新の通知（popup.jsに転送）
  if (message.action === 'updateProgress') {
    // 全てのタブにブロードキャスト
    chrome.runtime.sendMessage(message);
  }

  return false;
});

// 収集済みツイートIDを取得
async function getCollectedIds() {
  const result = await chrome.storage.local.get(['collectedTweetIds']);
  return result.collectedTweetIds || [];
}

// 収集済みツイートIDを追記保存
async function saveCollectedIds(newIds) {
  const existing = await getCollectedIds();
  const merged = Array.from(new Set([...existing, ...newIds]));
  await chrome.storage.local.set({ collectedTweetIds: merged });
  return merged.length;
}

// 収集履歴をリセット
async function resetCollectedIds() {
  await chrome.storage.local.remove(['collectedTweetIds']);
}

// 拡張機能インストール時
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('X Bookmark Saver がインストールされました');
  } else if (details.reason === 'update') {
    console.log('X Bookmark Saver が更新されました');
  }
});
