import TelegramBot from 'node-telegram-bot-api';
import * as process from 'process';

const token = process.env.TELEGRAM_BOT_TOKEN!;

export const bot = new TelegramBot(token, { polling: true });

export function prepareQuestionPromise(
    userId: number,
    questions: Array<{ question: string; answers: string[] }>,

    questionIndex: number
) {
    return bot.sendMessage(userId, questions[questionIndex]!.question, {
        reply_markup: {
            inline_keyboard: [
                questions[questionIndex]!.answers.map(answer => ({
                    text: answer,
                    callback_data: `option-${answer}`
                }))
            ]
        }
    });
}

export function prepareReminderPromise(userId: number) {
    return bot.sendMessage(userId, `The game is starting Now!`);
}

export function sendQuestionToAllUsers(
    userIds: number[],
    questions: Array<{ question: string; answers: string[] }>,
    questionIndex: number
): Promise<Array<TelegramBot.Message>> {
    return Promise.all(
        userIds.map(userId => prepareQuestionPromise(userId, questions, questionIndex))
    );
}

export function sendReminderToAllUsers(userIds: number[]): Promise<Array<TelegramBot.Message>> {
    return Promise.all(userIds.map(userId => prepareReminderPromise(userId)));
}

export function sendCorrectAnswerToAllUsers(
    userIds: number[],
    correctOption: string
): Promise<any> {
    return Promise.all(
        userIds.map(userId => bot.sendMessage(userId, `Correct Option: ${correctOption}`))
    );
}

export function sendGameOverToAllUsers(userIds: number[]): Promise<any> {
    return Promise.all(userIds.map(userId => bot.sendMessage(userId, 'Game Over!')));
}
