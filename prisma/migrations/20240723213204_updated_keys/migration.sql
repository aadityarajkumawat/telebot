/*
  Warnings:

  - The primary key for the `Response` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `Response` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[question,scheduledAt,userId]` on the table `Response` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `scheduledAt` to the `Response` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `Response` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Response" DROP CONSTRAINT "Response_pkey",
DROP COLUMN "id",
ADD COLUMN     "scheduledAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Response_question_scheduledAt_userId_key" ON "Response"("question", "scheduledAt", "userId");
