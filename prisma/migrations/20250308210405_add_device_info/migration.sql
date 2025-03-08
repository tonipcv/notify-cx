/*
  Warnings:

  - You are about to drop the column `registeredAt` on the `DeviceToken` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "DeviceToken" DROP COLUMN "registeredAt",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deviceInfo" JSONB,
ADD COLUMN     "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");
