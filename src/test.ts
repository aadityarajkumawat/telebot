import { db } from './ton-connect/storage';

async function test() {
    await db.connect();
    const userKeys = await db.keys('user:*');
    console.log(JSON.stringify(userKeys, null, 2));

    for (let key of userKeys) {
        const user = await db.get(key);
        console.log(JSON.stringify(JSON.parse(user || '{}'), null, 2));
    }

    // await db.get('').then(res => {
    //     console.log(JSON.stringify(JSON.parse(res || '{}'), null, 2));
    // });

    await db.disconnect();
}

test();
