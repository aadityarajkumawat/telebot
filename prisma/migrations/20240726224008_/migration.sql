/*
  Warnings:

  - You are about to drop the column `answers` on the `Response` table. All the data in the column will be lost.
  - Added the required column `response` to the `Response` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Response" DROP COLUMN "answers",
ADD COLUMN     "response" TEXT NOT NULL;
