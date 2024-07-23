import { Router } from 'express';
import moment from 'moment';
import { GAME_START_KEY, ROOM_START_KEY } from './consts';
import { prisma } from './prisma';
import { db } from './ton-connect/storage';

const router = Router();

export async function getTodaysQuiz(dateString: string) {
    const date = new Date(dateString);
    const questions = await prisma.question.findMany({
        where: {
            scheduledAt: date
        }
    });

    return { questions };
}

router.post('/todays-quiz', async (req, res) => {
    const questions = await getTodaysQuiz(req.body.date);
    return res.json({ questions });
});

router.get('/past-quizzes', async (_, res) => {
    const quizzes = await prisma.question.findMany({
        orderBy: {
            scheduledAt: 'desc'
        }
    });

    const quizzesGrouped = quizzes.reduce((acc: any, curr: any) => {
        const date = moment(curr.scheduledAt).format('MM/DD/YYYY');
        if (!acc[date]) {
            acc[date] = [];
        }

        acc[date].push(curr);
        return acc;
    }, {});

    return res.json({ quizzes: quizzesGrouped });
});

router.post('/save-questions', async (req, res) => {
    // delete previous questions
    const date = new Date(req.body.date);

    await prisma.question.deleteMany({
        where: {
            scheduledAt: date
        }
    });

    // add new questions
    const questions = req.body.questions as Array<{
        question: string;
        options: {
            option1: string;
            option2: string;
            option3: string;
            option4: string;
        };
        answers: Array<string>;
    }>;

    await prisma.question.createMany({
        data: questions.map(q => ({
            question: q.question,
            option1: q.options.option1,
            option2: q.options.option2,
            option3: q.options.option3,
            option4: q.options.option4,
            answers: q.answers,
            scheduledAt: date
        }))
    });

    return res.json({
        message: 'Questions added successfully',
        status: 'success'
    });
});

router.post('/game-time', async (req, res) => {
    // await redisClient.connect();
    const roomStartHour = req.body.roomStartHour;
    const roomStartMinutes = req.body.roomStartMinute;

    const gameStartHour = req.body.gameStartHour;
    const gameStartMinutes = req.body.gameStartMinute;

    await db.set(GAME_START_KEY, `${gameStartHour}:${gameStartMinutes}`);
    await db.set(ROOM_START_KEY, `${roomStartHour}:${roomStartMinutes}`);

    // await redisClient.disconnect();
    return res.json({
        message: 'Game time set successfully',
        status: 'success'
    });
});

router.get('/game-time', async (_, res) => {
    try {
        // await redisClient.connect();
        const gameStart = await db.get(GAME_START_KEY);
        const roomStart = await db.get(ROOM_START_KEY);

        console.log(gameStart, roomStart);

        if (!gameStart || !roomStart) {
            // await db.disconnect();
            return res.json({
                message: 'Game time not set',
                status: 'error'
            });
        }

        return res.json({
            gameStart,
            roomStart
        });
    } catch (error) {
        console.log(error);
        return res.json({
            message: 'Game time not set',
            status: 'error'
        });
    } finally {
        // await redisClient.disconnect();
    }
});

export default router;
