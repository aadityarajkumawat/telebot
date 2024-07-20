import { createClient } from '@redis/client';
import moment from 'moment-timezone';

const date = moment().utc().format('YYYY-MM-DD');

console.log(date);

const db = createClient();

db.connect().then(r => {
    db.get('response:7179731141').then(r => {
        console.log(JSON.stringify(JSON.parse(r || '{}'), null, 2));
    });
});
