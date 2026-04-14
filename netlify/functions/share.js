/* global process */

// Base62 alphabet for short IDs
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateShortId(length = 7) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return result;
}

async function getDbClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error('Missing TURSO_DATABASE_URL');
  }

  // Local file: use native client (has SQLite bindings)
  // Remote Turso: use web client (HTTP only, no native deps)
  if (url.startsWith('file:')) {
    const { createClient } = await import('@libsql/client');
    return createClient({ url });
  }

  if (!authToken) {
    throw new Error('Missing TURSO_AUTH_TOKEN for remote database');
  }

  const { createClient } = await import('@libsql/client/web');
  return createClient({ url, authToken });
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

export async function handler(event) {
  const { httpMethod } = event;

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    const db = await getDbClient();

    if (httpMethod === 'POST') {
      return await createShare(event, db);
    } else if (httpMethod === 'GET') {
      return await getShare(event, db);
    } else {
      return jsonResponse(405, { error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Function error:', error);
    return jsonResponse(500, { error: error.message });
  }
}

async function createShare(event, db) {
  const body = JSON.parse(event.body || '{}');
  const { type, sessionId, quizVersion, datasetId } = body;

  let dataToStore;
  if (type) {
    // Typed payload (simple, table, marcus, etc.) — store body minus metadata
    const { sessionId: _s, quizVersion: _q, ...data } = body;
    dataToStore = data;
  } else {
    // Legacy untyped format
    const { worldviews, activeWorldviewId } = body;
    if (!worldviews || !activeWorldviewId) {
      return jsonResponse(400, { error: 'Missing worldviews or activeWorldviewId' });
    }
    dataToStore = { worldviews, activeWorldviewId };
    if (datasetId) dataToStore.datasetId = datasetId;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const shortId = generateShortId();
    try {
      await db.execute({
        sql: `INSERT INTO shares (id, credences, session_id, quiz_version)
              VALUES (?, ?, ?, ?)`,
        args: [shortId, JSON.stringify(dataToStore), sessionId || null, quizVersion || null],
      });
      return jsonResponse(201, { id: shortId });
    } catch (error) {
      if (error.message?.includes('UNIQUE constraint')) {
        continue;
      }
      throw error;
    }
  }

  return jsonResponse(500, { error: 'Failed to generate unique ID' });
}

async function getShare(event, db) {
  let shareId = event.queryStringParameters?.id;

  if (!shareId) {
    // Try to get from path: /api/share/abc1234
    const path = event.path || '';
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2) {
      shareId = parts[parts.length - 1];
    }
  }

  if (!shareId) {
    return jsonResponse(400, { error: 'Missing share ID' });
  }

  const result = await db.execute({
    sql: 'SELECT credences, quiz_version, created_at FROM shares WHERE id = ?',
    args: [shareId],
  });

  if (result.rows.length === 0) {
    return jsonResponse(404, { error: 'Share not found' });
  }

  await db.execute({
    sql: `UPDATE shares
          SET access_count = access_count + 1,
              last_accessed_at = datetime('now')
          WHERE id = ?`,
    args: [shareId],
  });

  const row = result.rows[0];
  const storedData = JSON.parse(row.credences);

  const baseResponse = {
    id: shareId,
    quizVersion: row.quiz_version,
    createdAt: row.created_at,
  };

  if (storedData.type) {
    return jsonResponse(200, { ...baseResponse, ...storedData });
  }

  if (storedData.worldviews && storedData.activeWorldviewId) {
    return jsonResponse(200, {
      ...baseResponse,
      worldviews: storedData.worldviews,
      activeWorldviewId: storedData.activeWorldviewId,
      ...(storedData.datasetId && { datasetId: storedData.datasetId }),
    });
  }

  const firstQuestion = Object.values(storedData)[0];
  const isQuestionsFormat =
    firstQuestion && typeof firstQuestion === 'object' && 'credences' in firstQuestion;

  return jsonResponse(200, {
    ...baseResponse,
    ...(isQuestionsFormat ? { questions: storedData } : { credences: storedData }),
  });
}
