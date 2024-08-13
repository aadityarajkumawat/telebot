import { encodeTelegramUrlParameters, isTelegramUrl } from '@tonconnect/sdk';
import { InlineKeyboardButton } from 'node-telegram-bot-api';

export const AT_WALLET_APP_NAME = 'telegram-wallet';

export const pTimeoutException = Symbol();

export function pTimeout<T>(
    promise: Promise<T>,
    time: number,
    exception: unknown = pTimeoutException
): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
        promise,
        new Promise((_r, rej) => (timer = setTimeout(rej, time, exception)))
    ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export function addTGReturnStrategy(link: string, strategy: string): string {
    const parsed = new URL(link);
    parsed.searchParams.append('ret', strategy);
    link = parsed.toString();

    const lastParam = link.slice(link.lastIndexOf('&') + 1);
    return link.slice(0, link.lastIndexOf('&')) + '-' + encodeTelegramUrlParameters(lastParam);
}

export function convertDeeplinkToUniversalLink(link: string, walletUniversalLink: string): string {
    const search = new URL(link).search;
    const url = new URL(walletUniversalLink);

    if (isTelegramUrl(walletUniversalLink)) {
        const startattach = 'tonconnect-' + encodeTelegramUrlParameters(search.slice(1));
        url.searchParams.append('startattach', startattach);
    } else {
        url.search = search;
    }

    return url.toString();
}

export async function buildUniversalKeyboard(link: string): Promise<InlineKeyboardButton[]> {
    const keyboard = [
        {
            text: 'Open Link',
            url: `https://ton-connect.github.io/open-tc?connect=${encodeURIComponent(link)}`
        }
    ];

    return keyboard;
}

export function toKnownForm(
    questions: Array<{
        question: string;
        option1: string;
        option2: string;
        option3: string;
        option4: string;
    }>
) {
    return questions.map(question => {
        return {
            question: question.question,
            answers: [question.option1, question.option2, question.option3, question.option4]
        };
    });
}

export function isStringJSONLike(jsonString: string) {
    try {
        JSON.parse(jsonString);
    } catch {
        return false;
    }

    return true;
}

export function isStringIntLike(intString: string) {
    try {
        parseInt(intString);
    } catch (error) {
        return false;
    }

    return true;
}

function generateRandomId(
    length = 12,
    includeUppercase = false,
    includeLowercase = true,
    includeDigits = false
) {
    let charPool = '';

    if (includeUppercase) {
        charPool += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    }
    if (includeLowercase) {
        charPool += 'abcdefghijklmnopqrstuvwxyz';
    }
    if (includeDigits) {
        charPool += '0123456789';
    }

    if (!charPool) {
        throw new Error('At least one character type should be selected.');
    }

    let randomId = '';
    for (let i = 0; i < length; i++) {
        randomId += charPool.charAt(Math.floor(Math.random() * charPool.length));
    }

    return randomId;
}
