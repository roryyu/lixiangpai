/*
  Warnings:

  - You are about to drop the column `historyId` on the `Record` table. All the data in the column will be lost.
  - You are about to drop the `History` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `taskId` to the `Record` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "History" DROP CONSTRAINT "History_userId_fkey";

-- DropForeignKey
ALTER TABLE "Record" DROP CONSTRAINT "Record_historyId_fkey";

-- AlterTable
ALTER TABLE "Record" DROP COLUMN "historyId",
ADD COLUMN     "taskId" TEXT NOT NULL;

-- DropTable
DROP TABLE "History";

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
