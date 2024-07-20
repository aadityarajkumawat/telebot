import { CHAIN, isTelegramUrl, toUserFriendlyAddress, UserRejectsError } from '@tonconnect/sdk';
import { bot } from './bot';
import { getWallets, getWalletInfo } from './ton-connect/wallets';
import QRCode from 'qrcode';
import TelegramBot from 'node-telegram-bot-api';
import { getConnector } from './ton-connect/connector';
import {
    addTGReturnStrategy,
    buildUniversalKeyboard,
    isStringIntLike,
    isStringJSONLike,
    pTimeout,
    pTimeoutException
} from './utils';
import { mnemonicToWalletKey } from '@ton/crypto';
import { internal, TonClient, WalletContractV4 } from '@ton/ton';
import { getHttpEndpoint } from '@orbs-network/ton-access';
import { db } from './ton-connect/storage';

let newConnectRequestListenersMap = new Map<number, () => void>();

export async function handleConnectCommand(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    let messageWasDeleted = false;

    newConnectRequestListenersMap.get(chatId)?.();

    const connector = getConnector(chatId, () => {
        unsubscribe();
        newConnectRequestListenersMap.delete(chatId);
        deleteMessage();
    });

    await connector.restoreConnection();
    if (connector.connected) {
        const connectedName =
            (await getWalletInfo(connector.wallet!.device.appName))?.name ||
            connector.wallet!.device.appName;
        await bot.sendMessage(
            chatId,
            `You have already connect ${connectedName} wallet\nYour address: ${toUserFriendlyAddress(
                connector.wallet!.account.address,
                connector.wallet!.account.chain === CHAIN.TESTNET
            )}\n\n Disconnect wallet firstly to connect a new one`
        );

        return;
    }

    const unsubscribe = connector.onStatusChange(async wallet => {
        if (wallet) {
            await deleteMessage();

            const walletName =
                (await getWalletInfo(wallet.device.appName))?.name || wallet.device.appName;
            await bot.sendMessage(chatId, `${walletName} wallet connected successfully`);
            unsubscribe();
            newConnectRequestListenersMap.delete(chatId);
        }
    });

    const wallets = await getWallets();

    const link = connector.connect(wallets);
    const image = await QRCode.toBuffer(link);

    const keyboard = await buildUniversalKeyboard(link);

    const botMessage = await bot.sendPhoto(chatId, image, {
        reply_markup: {
            inline_keyboard: [keyboard]
        }
    });

    const deleteMessage = async (): Promise<void> => {
        if (!messageWasDeleted) {
            messageWasDeleted = true;
            await bot.deleteMessage(chatId, botMessage.message_id);
        }
    };

    newConnectRequestListenersMap.set(chatId, async () => {
        unsubscribe();

        await deleteMessage();

        newConnectRequestListenersMap.delete(chatId);
    });
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTon(to: string, amount: string) {
    // open wallet v4 (notice the correct wallet version here)
    // const mnemonic =
    //     'adapt water expand save satoshi jar leaf project rose rival promote news evidence congress actual answer wisdom keen demand oblige trade pigeon weather strong'; // your 24 secret words (replace ... with the rest of the words)
    const mnemonic =
        'young coffee rookie raw catch layer chef artist wife school try camera note text option minute magic urban admit famous frozen fee pony weasel';
    const key = await mnemonicToWalletKey(mnemonic.split(' '));
    const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });

    // initialize ton rpc client on testnet
    const endpoint = await getHttpEndpoint({ network: 'testnet' });
    const client = new TonClient({ endpoint });

    // make sure wallet is deployed
    if (!(await client.isContractDeployed(wallet.address))) {
        return console.log('wallet is not deployed');
    }

    // send 0.05 TON to EQA4V9tF4lY2S_J-sEQR7aUj9IwW-Ou2vJQlCn--2DLOLR5e
    const walletContract = client.open(wallet);
    const seqno = await walletContract.getSeqno();
    await walletContract.sendTransfer({
        secretKey: key.secretKey,
        seqno: seqno,
        messages: [
            internal({
                to,
                value: amount,
                bounce: false
            })
        ]
    });

    // wait until confirmed
    let currentSeqno = seqno;
    while (currentSeqno == seqno) {
        console.log('waiting for transaction to confirm...');
        await sleep(1500);
        currentSeqno = await walletContract.getSeqno();
    }
    console.log('transaction confirmed!');
}

export async function handleSendTXCommand(chatId: number, amount: number): Promise<void> {
    const connector = getConnector(chatId);

    await connector.restoreConnection();
    if (!connector.connected) {
        await bot.sendMessage(chatId, 'Connect wallet to send transaction');
        return;
    }

    pTimeout(
        sendTon(connector.wallet?.account.address || '', amount.toString()),
        Number(process.env.DELETE_SEND_TX_MESSAGE_TIMEOUT_MS)
    )
        .then(async () => {
            await bot.sendMessage(chatId, `Transaction sent successfully`);

            const userDoc = await db.get(`user:${chatId.toString()}`);

            if (!userDoc) {
                return;
            }

            if (!isStringJSONLike(userDoc)) {
                return;
            }

            const user = JSON.parse(userDoc);

            user.score -= amount;

            await db.set(`user:${chatId.toString()}`, JSON.stringify(user));

            await showUserProfile(chatId);
        })
        .catch(e => {
            if (e === pTimeoutException) {
                bot.sendMessage(chatId, `Transaction was not confirmed`);
                return;
            }

            if (e instanceof UserRejectsError) {
                bot.sendMessage(chatId, `You rejected the transaction`);
                return;
            }

            bot.sendMessage(chatId, `Unknown error happened`);
        })
        .finally(() => connector.pauseConnection());

    let deeplink = '';
    const walletInfo = await getWalletInfo(connector.wallet!.device.appName);
    if (walletInfo) {
        deeplink = walletInfo.universalLink;
    }

    if (isTelegramUrl(deeplink)) {
        const url = new URL(deeplink);
        url.searchParams.append('startattach', 'tonconnect');
        deeplink = addTGReturnStrategy(url.toString(), process.env.TELEGRAM_BOT_LINK!);
    }

    await bot.sendMessage(
        chatId,
        `Open ${walletInfo?.name || connector.wallet!.device.appName} and confirm transaction`,
        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: `Open ${walletInfo?.name || connector.wallet!.device.appName}`,
                            url: deeplink
                        }
                    ]
                ]
            }
        }
    );
}

export async function handleDisconnectCommand(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;

    const connector = getConnector(chatId);

    await connector.restoreConnection();
    if (!connector.connected) {
        await bot.sendMessage(chatId, "You didn't connect a wallet");
        return;
    }

    await connector.disconnect();

    await bot.sendMessage(chatId, 'Wallet has been disconnected');
}

export async function handleShowMyWalletCommand(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;

    const connector = getConnector(chatId);

    await connector.restoreConnection();
    if (!connector.connected) {
        await bot.sendMessage(chatId, "You didn't connect a wallet");
        return;
    }

    const walletName =
        (await getWalletInfo(connector.wallet!.device.appName))?.name ||
        connector.wallet!.device.appName;

    await bot.sendMessage(
        chatId,
        `Connected wallet: ${walletName}\nYour address: ${toUserFriendlyAddress(
            connector.wallet!.account.address,
            connector.wallet!.account.chain === CHAIN.TESTNET
        )}`
    );
}

export async function showLeaderBoard(chatId: number) {
    const users = await db.keys('user:*');
    const userScores = await Promise.all(
        users.map(async user => {
            const userDoc = await db.get(user);
            return JSON.parse(userDoc || '{}');
        })
    );

    const sortedUsers = userScores.sort((a, b) => b.score - a.score);

    const message = sortedUsers
        .map((user, index) => {
            return `${index + 1}. ${user.first_name} ${user.last_name} - ${user.score}`;
        })
        .join('\n');

    await bot.sendMessage(chatId, message);
}

export async function showUserProfile(chatId: number) {
    const userDoc = await db.get(`user:${chatId.toString()}`);
    if (!userDoc) {
        await bot.sendMessage(chatId, 'You have not signed up for the game!');
        return;
    }

    if (!isStringJSONLike(userDoc)) {
        await bot.sendMessage(chatId, 'Oops! We are unable to process your profile!');
        return;
    }

    const user = JSON.parse(userDoc);

    const connector = getConnector(chatId);

    await connector.restoreConnection();

    let walletConnected = connector.connected;

    await bot.sendMessage(
        chatId,
        `Name: ${user.first_name} ${user.last_name}\nScore: ${user.score}\nConnected Wallet: ${
            walletConnected
                ? `Yes (${connector.wallet?.device.appName})\nWallet: ${connector.wallet?.account.address}`
                : 'No'
        }`
    );
}

export async function handleRedeem(chatId: number) {
    const user = await db.get(`user:${chatId.toString()}`);

    if (!user) {
        await bot.sendMessage(chatId, 'You have not signed up for the game!');
        return;
    }

    if (!isStringJSONLike(user)) {
        await bot.sendMessage(chatId, 'You have not signed up for the game!');
        return;
    }

    const userDoc = JSON.parse(user);

    if (!userDoc.score) {
        await bot.sendMessage(chatId, 'You have not signed up for the game!');
        return;
    }

    await bot.sendMessage(
        chatId,
        'How many points do you want to redeem? [Reply in the following format: /redeem 10 for redeeming 10 points]'
    );
}

export async function handleRedeemAmount(chatId: number, text: string) {
    const user = await db.get(`user:${chatId.toString()}`);

    if (!user) {
        await bot.sendMessage(chatId, 'You have not signed up for the game!');
        return;
    }

    if (!isStringJSONLike(user)) {
        await bot.sendMessage(chatId, 'You have not signed up for the game!');
        return;
    }

    const userDoc = JSON.parse(user);

    if (!userDoc.score) {
        await bot.sendMessage(chatId, 'You have not signed up for the game!');
        return;
    }

    if (!isStringIntLike(text.replace('/redeem ', '').trim())) {
        await bot.sendMessage(chatId, 'Invalid amount!');
        return;
    }

    const amount = parseInt(text.replace('/redeem ', '').trim());

    if (userDoc.score < amount) {
        await bot.sendMessage(chatId, 'You do not have enough points to redeem!');
        return;
    }

    await handleSendTXCommand(chatId, amount);
}
