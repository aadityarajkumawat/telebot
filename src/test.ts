import { db } from './ton-connect/storage';

async function test() {
    await db.connect();
    await db.get('response:7179731141').then(res => {
        console.log(JSON.stringify(JSON.parse(res || '{}'), null, 2));
    });

    await db.disconnect();
}

test();
