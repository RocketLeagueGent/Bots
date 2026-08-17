import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

const BASE_URL = 'https://fpxtucteydpmuswitebs.supabase.co/functions/v1/api';

export class Cloud {
    static prefix = 'cloud';
    constructor(model_name, url) {
        this.base_url = url || BASE_URL;
        this.model_name = model_name;

        if (!hasKey('CLOUD_API_KEY')) {
            console.error('Error: CLOUD_API_KEY not found. Make sure it is set in keys.json or environment variables.');
        }
    }

    _buildMessage(turns, systemMessage) {
        let messages = [{ role: 'system', content: systemMessage }, ...turns];
        messages = strictFormat(messages);

        // Cloud API only accepts a single message; flatten conversation into one string
        let flat = '';
        for (const msg of messages) {
            const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
            flat += `[${role}]\n${msg.content}\n\n`;
        }
        return flat.trim();
    }

    async sendRequest(turns, systemMessage, stop_seq = '*') {
        const message = this._buildMessage(turns, systemMessage);

        const body = {
            message,
            use_data_feed: this.model_name !== 'no-data',
            system_prompt: systemMessage,
        };

        try {
            console.log('Awaiting Cloud API response...');
            const res = await fetch(`${this.base_url}/chat`, {
                method: 'POST',
                headers: {
                    'x-api-key': getKey('CLOUD_API_KEY'),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                console.error('Cloud API error:', data.error || data);
                return 'My brain disconnected, try again.';
            }

            console.log('Received.');
            return data.answer || 'No response received.';
        } catch (err) {
            console.error('Error while awaiting Cloud response:', err);
            return 'My brain disconnected, try again.';
        }
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        // Cloud API does not support vision; fall back to text-only
        return this.sendRequest(messages, systemMessage);
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by Cloud API.');
    }
}
