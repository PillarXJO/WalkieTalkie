-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "data" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "ChannelMember" ALTER COLUMN "permissions" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Membership" ALTER COLUMN "permissions" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "Workspace" ALTER COLUMN "settings" SET DATA TYPE TEXT;
