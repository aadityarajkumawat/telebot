/*
  Warnings:

  - You are about to drop the column `questionId` on the `Response` table. All the data in the column will be lost.
  - Added the required column `question` to the `Response` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Response" DROP CONSTRAINT "Response_questionId_fkey";

-- AlterTable
ALTER TABLE "Response" DROP COLUMN "questionId",
ADD COLUMN     "question" TEXT NOT NULL;
