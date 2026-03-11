// AWS Lambda handler for share URL API
// Converted from Netlify function for Lambda Function URL

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

  if (!authToken) {
    throw new Error('Missing TURSO_AUTH_TOKEN');
  }

  // Lambda always uses web client (HTTP only, no native deps)
  const { createClient } = await import('@libsql/client/web');
  return createClient({ url, authToken });
}

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
};

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: RESPONSE_HEADERS,
    body: JSON.stringify(data),
  };
}

export async function handler(event) {
  const httpMethod = event.requestContext?.http?.method || event.httpMethod;

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: RESPONSE_HEADERS, body: '' };
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
  let bodyStr = event.body || '{}';
  if (event.isBase64Encoded) {
    bodyStr = Buffer.from(bodyStr, 'base64').toString('utf-8');
  }

  const body = JSON.parse(bodyStr);
  const { type, sessionId, quizVersion } = body;

  let dataToStore;
  if (type === 'table' || type === 'marcus') {
    const { worldviews, credences, stages, selectedMethod, totalBudget, methodOptions } = body;
    if (!worldviews) {
      return jsonResponse(400, { error: 'Missing worldviews' });
    }
    dataToStore = { type, worldviews, credences };
    if (stages) {
      dataToStore.stages = stages;
    } else {
      dataToStore.selectedMethod = selectedMethod;
      dataToStore.totalBudget = totalBudget;
      dataToStore.methodOptions = methodOptions;
    }
  } else {
    const { worldviews, activeWorldviewId } = body;
    if (!worldviews || !activeWorldviewId) {
      return jsonResponse(400, { error: 'Missing worldviews or activeWorldviewId' });
    }
    dataToStore = { worldviews, activeWorldviewId };
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
  const shareId = event.queryStringParameters?.id;

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

  if (storedData.type === 'table' || storedData.type === 'marcus') {
    return jsonResponse(200, { ...baseResponse, ...storedData });
  }

  if (storedData.worldviews && storedData.activeWorldviewId) {
    return jsonResponse(200, {
      ...baseResponse,
      worldviews: storedData.worldviews,
      activeWorldviewId: storedData.activeWorldviewId,
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
