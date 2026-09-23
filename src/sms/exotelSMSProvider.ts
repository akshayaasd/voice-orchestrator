import https from 'https';
import { SMSProvider, SMSMessage } from './smsProvider';

/**
 * Exotel SMS Provider — India Primary
 * ─────────────────────────────────────────────────────────────────────────────
 * Sends SMS via Exotel's REST API. Exotel is the recommended provider for
 * India-based voice AI deployments alongside their PSTN SIP trunks.
 *
 * API docs: https://developer.exotel.com/api/#send-an-sms
 *
 * Request:
 *   POST https://{sid}:{token}@api.exotel.com/v1/Accounts/{sid}/Sms/send.json
 *   Body: From=<VN>&To=<callerPhone>&Body=<text>
 */
export class ExotelSMSProvider implements SMSProvider {
  private sid:         string;
  private apiKey:      string;
  private apiToken:    string;
  private subdomain:   string;

  constructor(params: {
    sid:       string;
    apiKey:    string;
    apiToken:  string;
    subdomain?: string; // Default: api.exotel.com
  }) {
    this.sid       = params.sid;
    this.apiKey    = params.apiKey;
    this.apiToken  = params.apiToken;
    this.subdomain = params.subdomain ?? 'api.exotel.com';
  }

  async send(message: SMSMessage): Promise<void> {
    const body = new URLSearchParams({
      From: message.from,
      To:   message.to,
      Body: message.body,
    }).toString();

    const url = `https://${this.subdomain}/v1/Accounts/${this.sid}/Sms/send.json`;
    const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path:     urlObj.pathname,
        method:   'POST',
        headers:  {
          'Authorization': `Basic ${auth}`,
          'Content-Type':  'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[ExotelSMS] ✅ Sent to ${message.to}: "${message.body.slice(0, 40)}..."`);
            resolve();
          } else {
            console.error(`[ExotelSMS] ❌ Failed (HTTP ${res.statusCode}):`, data);
            reject(new Error(`Exotel SMS failed: HTTP ${res.statusCode} — ${data}`));
          }
        });
      });

      req.on('error', (err) => {
        console.error('[ExotelSMS] Request error:', err);
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }
}
