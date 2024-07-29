import dotenv from 'dotenv';
dotenv.config();

import cors from 'cors';
import { config } from 'dotenv';
import express from 'express';
import moment from 'moment-timezone';
import cron from 'node-cron';
import api, { getTodaysQuiz } from './api';
import { bot, sendGameOverToAllUsers, sendQuestionToAllUsers, sendReminderToAllUsers } from './bot';
import {
    handleConnectCommand,
    handleDisconnectCommand,
    handleRedeem,
    handleRedeemAmount,
    showLeaderBoard,
    showUserProfile
} from './commands-handlers';
import { walletMenuCallbacks } from './connect-wallet-menu';
import { Logger } from './logger';
import { db, initRedisClient } from './ton-connect/storage';
import { isStringJSONLike, toKnownForm } from './utils';
import {
    gameStartHour,
    gameStartMinute,
    QUESTION_TIME_GAP,
    roomStartHour,
    roomStartMinute,
    TIMEZONE
} from './consts';
import { prisma } from './prisma';

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
            await bot.sendMessage(
                chat.id,
                `Thanks for signing up!\nThe game room starts at 7:00 PM UTC and beings at 7:10 PM UTC\nWe'll send you notifications reminding about the game\nThank you`
            );
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
        } else if (text === 'hack') {
            await bot.sendMessage(chat.id, 'Simulating the game!');

            await startRoom();
            await new Promise(resolve => setTimeout(resolve, 10000));
            await startGame();
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
                    await bot.sendMessage(message.chat.id, `Game stars at ${'7:10'} UTC!`);
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

                // remove ✅ from other options
                options.forEach(option => {
                    if (option !== ref && option.text.includes('✅')) {
                        option.text = option.text.replace('✅', '').trim();
                    }
                });

                // console.log(JSON.stringify(options, null, 2));

                const editresponse = await bot.editMessageReplyMarkup(
                    {
                        inline_keyboard: [options]
                    },
                    { chat_id: message.chat.id, message_id: message.message_id }
                );

                // console.log(editresponse);

                if (!message.text) {
                    await bot.answerCallbackQuery(msg.id, { text: 'No question text found!' });
                    return;
                }

                // console.log('UPSERTING>>>');

                const added = await prisma.response.upsert({
                    create: {
                        question: message.text || '',
                        scheduledAt: new Date(moment().utc().format('YYYY-MM-DD')),
                        userId: message.chat.id.toString(),
                        response: ref.text
                    },
                    update: {
                        response: ref.text
                    },
                    where: {
                        question_scheduledAt_userId: {
                            question: message.text || '',
                            scheduledAt: new Date(moment().utc().format('YYYY-MM-DD')),
                            userId: message.chat.id.toString()
                        }
                    }
                });

                // console.log({ added });

                await bot.answerCallbackQuery(msg.id);
            }
        } catch (error) {
            logger.error(error);
        }
    });

    const serverTimeZone = moment.tz.guess();

    logger.info(`Server time zone: ${serverTimeZone}`);

    async function startRoom() {
        gameStarted = false;
        currentIndex.set(0);
        let joinedUsers = await db.keys('joining:*');
        const deletePromises = joinedUsers.map(user => db.del(user));
        await Promise.all(deletePromises);
        const body = await getTodaysQuiz(moment().utc().format('MM/DD/YYYY'));
        if (!body.questions) {
            console.log('no questions today');
            return;
        }

        QUESTIONS = toKnownForm(body.questions);

        const signedUpUsers = await db.keys('user:*');
        joinedUsers = await db.keys('joining:*');

        const joinedUserIds = joinedUsers.map(user => user.split(':')[1]).map(Number);
        const userIds = signedUpUsers.map(user => user.split(':')[1]).map(Number);

        // console.log('Joined user ids:', joinedUserIds);

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
    }

    async function startGame() {
        try {
            gameStarted = true;
            logger.info('Game has started!');

            const joinedUsers = await db.keys('joining:*');
            let joinedUserIds = joinedUsers.map(user => user.split(':')[1]).map(Number);

            if (QUESTIONS.length === 0) {
                console.log('NO QUESTIONS');
                // send no game today message
                return;
            }

            const copyQuestions: Array<Question> = [...QUESTIONS, { question: '', answers: [] }];

            for (let i = 0; i < copyQuestions.length; i++) {
                // check previous responses
                const prevQuestion = QUESTIONS[currentIndex.get() - 1];
                if (!prevQuestion) {
                    console.log('SERVER ERROR [INDEX NOT FOUND]:', currentIndex.get() - 1);
                } else {
                    const date = moment().utc().format('YYYY-MM-DD');
                    const questionText = prevQuestion.question;

                    // find the minority chosen option
                    const minorityOption = await prisma.response.groupBy({
                        by: 'response',
                        _count: {
                            response: true
                        },
                        where: {
                            question: questionText,
                            scheduledAt: new Date(date)
                        }
                    });

                    // find the response with min count
                    let minDocument = { response: '', _count: { response: Infinity } };
                    for (let item of minorityOption) {
                        if (item._count.response < minDocument._count.response) {
                            minDocument = item;
                        }
                    }

                    for (const userId of joinedUserIds) {
                        const doc = await prisma.response.findFirst({
                            where: {
                                userId: userId.toString(),
                                scheduledAt: new Date(date),
                                question: questionText
                            }
                        });

                        if (!doc) {
                            await bot.sendMessage(
                                userId,
                                `You did not answer the question: ${questionText}\nGame Over!`
                            );
                            joinedUserIds = joinedUserIds.filter(id => id !== userId);
                            continue;
                        }

                        if (doc.response !== minDocument.response) {
                            await bot.sendMessage(
                                userId,
                                `You answered the question: ${questionText} incorrectly!\nGame Over!`
                            );
                            joinedUserIds = joinedUserIds.filter(id => id !== userId);
                        }
                    }
                }

                if (i === 0) {
                    await sendReminderToAllUsers(joinedUserIds);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }

                if (i !== copyQuestions.length - 1) {
                    // check answers to previous questions
                    await sendQuestionToAllUsers(joinedUserIds, QUESTIONS, currentIndex.get());

                    // wait for 3 seconds
                    await new Promise(resolve => setTimeout(resolve, QUESTION_TIME_GAP));
                    currentIndex.inc();
                }
            }

            await sendGameOverToAllUsers(joinedUserIds);

            // update leader board
            for (const userId of joinedUserIds) {
                const userDoc = await db.get(`user:${userId}`);
                if (!userDoc) {
                    continue;
                }

                const user = JSON.parse(userDoc);
                const score = user.score;

                if (score) {
                    user.score = score + 1;
                }

                await db.set(`user:${userId}`, JSON.stringify(user));
            }

            // ----- CLEANUP FOR NEXT DAY -----
            const deletePromises = joinedUsers.map(user => db.del(user));
            await Promise.all(deletePromises);
        } catch (error) {
            logger.error(error);
        }
    }

    // at 7 PM UTC
    cron.schedule(`${roomStartMinute} ${roomStartHour} * * *`, startRoom, { timezone: TIMEZONE });

    // at 7:10 PM UTC
    cron.schedule(`${gameStartMinute} ${gameStartHour} * * *`, startGame, { timezone: TIMEZONE });

    // while (true) {
    //     await new Promise(resolve => setTimeout(resolve, 10000));
    //     await startRoom();
    //     await new Promise(resolve => setTimeout(resolve, 5000));
    //     await startGame();
    // }
}

main();

config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (_, res) => {
    res.send('Hello World!');
});

app.use('/api', api);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
