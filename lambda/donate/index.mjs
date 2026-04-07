// AWS Lambda handler for donation intent API

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

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

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendNotificationEmail(name, refId, memo) {
  const senderEmail = process.env.SENDER_EMAIL;
  const notifyEmail = process.env.NOTIFY_EMAIL;

  if (!senderEmail || !notifyEmail) {
    console.warn('SENDER_EMAIL or NOTIFY_EMAIL not configured, skipping email');
    return false;
  }

  const date = new Date().toISOString().split('T')[0];
  const ses = new SESClient({});

  await ses.send(new SendEmailCommand({
    Source: senderEmail,
    Destination: { ToAddresses: [notifyEmail] },
    Message: {
      Subject: { Data: `Donation intent: ${name} — ${date}` },
      Body: { Text: { Data: memo } },
    },
  }));

  return true;
}

export async function handler(event) {
  const httpMethod = event.requestContext?.http?.method || event.httpMethod;

  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: RESPONSE_HEADERS, body: '' };
  }

  if (httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    let bodyStr = event.body || '{}';
    if (event.isBase64Encoded) {
      bodyStr = Buffer.from(bodyStr, 'base64').toString('utf-8');
    }

    const body = JSON.parse(bodyStr);
    const { name, email, anonymity, splitPreference, splits, amount, refId, memo } = body;

    // Validate required fields
    const errors = [];
    if (!name || !name.trim()) errors.push('name is required');
    if (!email || !validateEmail(email)) errors.push('a valid email is required');
    if (!anonymity || !['anonymous', 'consent'].includes(anonymity))
      errors.push('anonymity selection is required');
    if (!splitPreference || !['defer', 'recommended', 'custom'].includes(splitPreference))
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

    // Send email notification
    let emailSent = false;
    try {
      emailSent = await sendNotificationEmail(name.trim(), refId, memo);
    } catch (error) {
      console.error('Email send failed:', error);
    }

    return jsonResponse(201, { success: true, refId, id, emailSent });
  } catch (error) {
    console.error('Function error:', error);
    return jsonResponse(500, { error: 'Internal server error' });
  }
}
