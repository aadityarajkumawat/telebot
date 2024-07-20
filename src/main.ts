import dotenv from 'dotenv';
dotenv.config();

import moment from 'moment-timezone';
import cron from 'node-cron';
import { bot, sendGameOverToAllUsers, sendQuestionToAllUsers } from './bot';
import {
    handleConnectCommand,
    handleDisconnectCommand,
    handleRedeem,
    handleRedeemAmount,
    showLeaderBoard,
    showUserProfile
} from './commands-handlers';
import { walletMenuCallbacks } from './connect-wallet-menu';
import { BASE_URL } from './consts';
import { Logger } from './logger';
import { db, initRedisClient } from './ton-connect/storage';
import { isStringJSONLike, toKnownForm } from './utils';

const logger = Logger();

let currentIndex = {
    index: 0,
    set: (index: number) => {
        currentIndex.index = index;
    },
    get: () => {
        return currentIndex.index;
    },
    inc: (value: number = 1) => {
        currentIndex.index += value;
    }
};

async function main(): Promise<void> {
    let gameStarted = false;

    let QUESTIONS = [] as Array<Question>;

    await initRedisClient();

    const callbacks = {
        ...walletMenuCallbacks
    };

    await bot.setMyCommands([
        { command: '/start', description: 'Sign up for daily games' },
        { command: '/connect', description: 'Connect your wallet' },
        { command: '/disconnect', description: 'Disconnect your wallet' },
        { command: '/redeem', description: 'Redeem your points to connected wallet' },
        { command: '/leaderboard', description: 'Show the leaderboard' },
        { command: '/profile', description: 'Show your profile' }
    ]);

    bot.on('message', async msg => {
        const from = msg.from;
        const chat = msg.chat;
        const text = msg.text;

        if (!from || !chat || !text) {
            logger.error('No from or chat or text in message');
            return;
        }

        if (text === '/start') {
            const userDoc = await db.get(`user:${chat.id.toString()}`);
            if (userDoc) {
                await bot.sendMessage(chat.id, 'You have already signed up!');
                return;
            }
            await db.set(`user:${chat.id.toString()}`, JSON.stringify({ ...from, score: 1 }));
        } else if (text === '/connect') {
            await handleConnectCommand(msg);
        } else if (text === '/disconnect') {
            await handleDisconnectCommand(msg);
        } else if (text.includes('/redeem')) {
            if (text.split(' ').length < 2) {
                await handleRedeem(chat.id);
                return;
            }
            await handleRedeemAmount(chat.id, text);
        } else if (text === '/leaderboard') {
            await showLeaderBoard(chat.id);
        } else if (text === '/profile') {
            await showUserProfile(chat.id);
        } else {
            await bot.sendMessage(chat.id, 'Unknown command!');
        }
    });

    bot.on('callback_query', async msg => {
        try {
            logger.info(msg);
            if (!msg.message) {
                logger.error('No message in callback_query');
                return;
            }

            if (!msg.data) {
                return;
            }

            const isWalletQuery = isStringJSONLike(msg.data);

            if (isWalletQuery) {
                const { method, data } = JSON.parse(msg.data);

                if (!callbacks[method as keyof typeof callbacks]) {
                    return;
                }

                callbacks[method as keyof typeof callbacks](msg, data);

                return;
            }

            const message = msg.message;

            const replyMarkup = message.reply_markup;

            if (!replyMarkup || !replyMarkup.inline_keyboard) {
                logger.error('No inline keyboard in message');
                return;
            }

            const inlineKeyboard = replyMarkup.inline_keyboard;

            if (inlineKeyboard.length === 0) {
                logger.error('No buttons in inline keyboard');
                return;
            }

            const button = inlineKeyboard[0] ? inlineKeyboard[0][0] : null;

            if (!button || !button.callback_data) {
                logger.error('No callback data in button');
                return;
            }

            if (msg.data && msg.data === 'join_game') {
                await bot.answerCallbackQuery(msg.id);
                const alreadyJoined = await db.get(`joining:${message.chat.id.toString()}`);

                if (gameStarted) {
                    logger.info('Game has already started!');
                    return;
                }

                if (alreadyJoined) {
                    await bot.sendMessage(message.chat.id, 'You have already joined the game!');
                    return;
                }

                if (!gameStarted) {
                    await db.set(`joining:${message.chat.id.toString()}`, 0);
                    await bot.sendMessage(message.chat.id, 'Game stars at 7:10 PM UTC!');
                } else {
                    await bot.sendMessage(message.chat.id, 'Sorry, the game has already started!');
                }
            } else if (msg.data && msg.data.startsWith('option-')) {
                const questionIndex = QUESTIONS.findIndex(qu => qu.question === message.text);

                logger.info('Question index:', questionIndex, 'Current Index:', currentIndex.get());

                if (questionIndex !== currentIndex.get()) {
                    await bot.answerCallbackQuery(msg.id, {
                        text: 'You have already answered this question!'
                    });
                    return;
                }

                const reply_markup = message.reply_markup?.inline_keyboard;

                if (!reply_markup || !reply_markup[0]) {
                    return;
                }

                const [options] = reply_markup;

                if (!options) {
                    return;
                }

                const toUpdate = options.findIndex(option => option.callback_data === msg.data);

                if (toUpdate === -1) {
                    return;
                }

                const ref = options[toUpdate];

                if (!ref) {
                    return;
                }

                if (!ref.text.includes('✅')) {
                    ref.text = `${ref.text} ✅`;
                } else {
                    ref.text = ref.text.replace('✅', '').trim();
                }

                console.log(JSON.stringify(options, null, 2));

                const editresponse = await bot.editMessageReplyMarkup(
                    {
                        inline_keyboard: [options]
                    },
                    { chat_id: message.chat.id, message_id: message.message_id }
                );

                console.log(editresponse);

                // patch the document in db
                const responseDoc = await db.get(`response:${message.chat.id.toString()}`);
                if (!responseDoc) {
                    await db.set(`response:${message.chat.id.toString()}`, JSON.stringify({}));
                }

                const response = JSON.parse(responseDoc || '{}');

                // get todays date
                const utcDate = moment().utc().format('YYYY-MM-DD');

                if (!response[utcDate]) {
                    response[utcDate] = [];
                }

                const ifQuestionExists = response[utcDate].findIndex(
                    (entry: any) => entry.question === message.text
                );

                if (ifQuestionExists === -1) {
                    response[utcDate].push({
                        question: message.text,
                        options
                    });
                } else {
                    response[utcDate][ifQuestionExists].options = options;
                }

                await db.set(`response:${message.chat.id.toString()}`, JSON.stringify(response));
            }
        } catch (error) {
            logger.error(error);
        }
    });

    const serverTimeZone = moment.tz.guess();
    const utcOffset = moment.tz('UTC').utcOffset();
    const serverOffset = moment.tz(serverTimeZone).utcOffset();
    const timeDifference = (serverOffset - utcOffset) / 60; // in hours
    const serverRunHour = (19 + timeDifference + 24) % 24; // 7 PM UTC

    logger.info(`Server time zone: ${serverTimeZone}`, `Server run hour: ${serverRunHour}`);

    // at 7 PM UTC
    cron.schedule(`0 ${serverRunHour} * * *`, async () => {
        const res = await fetch(`${BASE_URL}/api/todays-quiz`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date: moment().utc().format('MM/DD/YYYY')
            })
        });

        const body = await res.json();

        if (!body.questions) {
            console.log('no questions today');
            return;
        }

        QUESTIONS = toKnownForm(body.questions);

        const signedUpUsers = await db.keys('user:*');
        const joinedUsers = await db.keys('joining:*');

        const joinedUserIds = joinedUsers.map(user => user.split(':')[1]).map(Number);
        const userIds = signedUpUsers.map(user => user.split(':')[1]).map(Number);

        const notJoinedUserIds = userIds.filter(userId => !joinedUserIds.includes(userId));

        logger.info('Not joined user ids', notJoinedUserIds);

        // @TODO: Switch with notJoinedUserIds
        const sendMessagePromises = notJoinedUserIds.map(userId =>
            bot.sendMessage(userId, "Hello, it's time for the game!\nAre you in?", {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Yes, I'm in!",
                                callback_data: 'join_game'
                            }
                        ]
                    ]
                }
            })
        );

        await Promise.all(sendMessagePromises);
    });

    const minutes = new Date().getMinutes();
    // logger.info(`Running game at: ${minutes + 2}`);

    // at 7:10 PM UTC
    cron.schedule(`10 ${serverRunHour} * * *`, async () => {
        gameStarted = true;
        logger.info('Game has started!');

        const joinedUsers = await db.keys('joining:*');
        const joinedUserIds = joinedUsers.map(user => user.split(':')[1]).map(Number);

        if (QUESTIONS.length === 0) {
            console.log('NO QUESTIONS');
            // send no game today message
            return;
        }

        for (const _ of QUESTIONS) {
            await sendQuestionToAllUsers(joinedUserIds, QUESTIONS, currentIndex.get());

            // wait for 3 seconds
            await new Promise(resolve => setTimeout(resolve, 5000));
            currentIndex.inc();
        }

        await sendGameOverToAllUsers(joinedUserIds);

        // update leader board
        for (const userId of joinedUserIds) {
            const userDoc = await db.get(`user:${userId}`);
            if (!userDoc) {
                await bot.sendMessage(
                    userId,
                    'Oops! We are unable to process your score! [no user data]'
                );
                return;
            }

            if (!isStringJSONLike(userDoc)) {
                await bot.sendMessage(
                    userId,
                    'Oops! We are unable to process your score! [user doc not like json]'
                );
                return;
            }

            const user = JSON.parse(userDoc);

            if (!user.score) {
                user.score = 0;
            }

            // check if they answered the questions correctly
            const responseDoc = await db.get(`response:${userId}`);
            const date = moment().utc().format('YYYY-MM-DD');

            const questions = JSON.parse(responseDoc || '{}');

            if (!questions[date]) {
                await bot.sendMessage(userId, 'You did not answer any questions today!');
                return;
            }

            let score = 0;

            for (const question of questions[date]) {
                let ques = question as {
                    question: string;
                    options: Array<{ text: string; callback_data: string }>;
                };
                const userSelected = ques.options
                    .filter(option => option.text.includes('✅'))
                    .map(option => option.text.replace('✅', '').trim());

                const correctAnswers = QUESTIONS.find(quest => quest.question === ques.question);
                console.log('Correct Answers:', correctAnswers, 'User Selected:', userSelected);

                if (!correctAnswers) {
                    await bot.sendMessage(
                        userId,
                        'Oops! We are unable to process your score! [no correct answers found]'
                    );
                    return;
                }

                const correct = correctAnswers.correctAnswers;

                let diff = correct.filter(function (x) {
                    return userSelected.indexOf(x) < 0;
                });

                if (diff.length === 0) {
                    user.score += 1;
                }

                await db.set(`user:${userId}`, JSON.stringify(user));
            }
            await bot.sendMessage(userId, `Your score is updated: ${user.score}`);
        }

        // ----- CLEANUP FOR NEXT DAY -----
        const deletePromises = joinedUsers.map(user => db.del(user));
        await Promise.all(deletePromises);
    });
}

main();
