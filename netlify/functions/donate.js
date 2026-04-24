/* global exports, process */

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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function logEmail(name, refId, body) {
  const date = new Date().toISOString().split('T')[0];
  console.log('========== EMAIL NOTIFICATION (local dev) ==========');
  console.log(`To:      ${process.env.NOTIFY_EMAIL || 'giving@rethinkpriorities.org'}`);
  console.log(`From:    ${process.env.SENDER_EMAIL || 'noreply@rethinkpriorities.org'}`);
  console.log(`Subject: Donation intent: ${name} — ${date}`);
  console.log('--- Body ---');
  console.log(body);
  console.log('================================================');
}

exports.handler = async function (event) {
  const { httpMethod } = event;

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { name, email, anonymity, splitPreference, splits, refId, memo, emailExtras } = body;

    // Validate required fields
    const errors = [];
    if (!name || !name.trim()) errors.push('name is required');
    if (!email || !validateEmail(email)) errors.push('a valid email is required');
    if (!anonymity || !['anonymous', 'consent', 'charityvestPublish'].includes(anonymity))
      errors.push('anonymity selection is required');
    if (!splitPreference || !['defer', 'custom'].includes(splitPreference))
      errors.push('split preference is required');

    if (splitPreference === 'custom' && splits) {
      const total = Object.values(splits).reduce((s, v) => s + (parseFloat(v) || 0), 0);
      if (Math.round(total * 10) / 10 !== 100) {
        errors.push('custom splits must sum to 100%');
      }
    }

    if (!memo || !memo.trim()) errors.push('memo is required');

    if (errors.length) {
      return jsonResponse(400, { error: errors.join('; ') });
    }

    // Save to database
    const db = await getDbClient();
    let id;

    for (let attempt = 0; attempt < 5; attempt++) {
      id = generateShortId();
      try {
        await db.execute({
          sql: `INSERT INTO donations (id, ref_id, email, form_data, memo)
                VALUES (?, ?, ?, ?, ?)`,
          args: [id, refId, email.trim(), JSON.stringify(body), memo],
        });
        break;
      } catch (error) {
        if (error.message?.includes('UNIQUE constraint')) {
          id = null;
          continue;
        }
        throw error;
      }
    }

    if (!id) {
      return jsonResponse(500, { error: 'Failed to generate unique ID' });
    }

    console.log('Donation intent saved:', { id, refId, email: email.trim() });

    // Log email locally (no SES in dev)
    const emailBody = emailExtras ? `${memo}\n\n${emailExtras}` : memo;
    logEmail(name.trim(), refId, emailBody);

    return jsonResponse(201, { success: true, refId, id, emailSent: false });
  } catch (error) {
    console.error('Function error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
};
