import { IStorage } from '@tonconnect/sdk';
import { createClient } from 'redis';

export const db = createClient({ url: process.env.REDIS_URL });

db.on('error', err => console.log('Redis Client Error', err));

export async function initRedisClient(): Promise<void> {
    await db.connect();
}
export class TonConnectStorage implements IStorage {
    constructor(private readonly chatId: number) {}

    private getKey(key: string): string {
        return this.chatId.toString() + key;
    }

    async removeItem(key: string): Promise<void> {
        await db.del(this.getKey(key));
    }

    async setItem(key: string, value: string): Promise<void> {
        await db.set(this.getKey(key), value);
    }

    async getItem(key: string): Promise<string | null> {
        return (await db.get(this.getKey(key))) || null;
    }
}
