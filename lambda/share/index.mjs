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

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

export async function handler(event) {
  // Lambda Function URL uses requestContext.http.method
  const httpMethod = event.requestContext?.http?.method || event.httpMethod;

  // Preflight is handled by AWS Function URL CORS config
  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: responseHeaders, body: '' };
  }

  try {
    const db = await getDbClient();

    if (httpMethod === 'POST') {
      return await createShare(event, db);
    } else if (httpMethod === 'GET') {
      return await getShare(event, db);
    } else {
      return {
        statusCode: 405,
        headers: responseHeaders,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }
  } catch (error) {
    console.error('Function error:', error);
    return {
      statusCode: 500,
      headers: responseHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}

async function createShare(event, db) {
  // Lambda Function URL may base64-encode the body
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
      return {
        statusCode: 400,
        headers: responseHeaders,
        body: JSON.stringify({ error: 'Missing worldviews' }),
      };
    }
    // Support both new (stages) and old (selectedMethod/totalBudget/methodOptions) format
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
      return {
        statusCode: 400,
        headers: responseHeaders,
        body: JSON.stringify({ error: 'Missing worldviews or activeWorldviewId' }),
      };
    }
    dataToStore = { worldviews, activeWorldviewId };
  }

  // Generate unique short ID (retry on collision)
  for (let attempt = 0; attempt < 5; attempt++) {
    const shortId = generateShortId();
    try {
      await db.execute({
        sql: `INSERT INTO shares (id, credences, session_id, quiz_version)
              VALUES (?, ?, ?, ?)`,
        args: [shortId, JSON.stringify(dataToStore), sessionId || null, quizVersion || null],
      });

      return {
        statusCode: 201,
        headers: responseHeaders,
        body: JSON.stringify({ id: shortId }),
      };
    } catch (error) {
      if (error.message?.includes('UNIQUE constraint')) {
        continue;
      }
      throw error;
    }
  }

  return {
    statusCode: 500,
    headers: responseHeaders,
    body: JSON.stringify({ error: 'Failed to generate unique ID' }),
  };
}

async function getShare(event, db) {
  // Get ID from query string
  const shareId = event.queryStringParameters?.id;

  if (!shareId) {
    return {
      statusCode: 400,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Missing share ID' }),
    };
  }

  const result = await db.execute({
    sql: 'SELECT credences, quiz_version, created_at FROM shares WHERE id = ?',
    args: [shareId],
  });

  if (result.rows.length === 0) {
    return {
      statusCode: 404,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Share not found' }),
    };
  }

  // Update access stats
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

  // Table/Marcus format: return full stored data
  if (storedData.type === 'table' || storedData.type === 'marcus') {
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({ ...baseResponse, ...storedData }),
    };
  }

  // Worldviews format: has worldviews and activeWorldviewId
  if (storedData.worldviews && storedData.activeWorldviewId) {
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        ...baseResponse,
        worldviews: storedData.worldviews,
        activeWorldviewId: storedData.activeWorldviewId,
      }),
    };
  }

  // Detect questions format vs legacy credences format
  const firstQuestion = Object.values(storedData)[0];
  const isQuestionsFormat =
    firstQuestion && typeof firstQuestion === 'object' && 'credences' in firstQuestion;

  return {
    statusCode: 200,
    headers: responseHeaders,
    body: JSON.stringify({
      ...baseResponse,
      ...(isQuestionsFormat ? { questions: storedData } : { credences: storedData }),
    }),
  };
}
