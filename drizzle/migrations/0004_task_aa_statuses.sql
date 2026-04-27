ALTER TABLE `agent_assignments` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE `agent_assignments` SET `status` = CASE WHEN `completed` = 1 THEN 'done' ELSE 'pending' END;--> statement-breakpoint
ALTER TABLE `agent_assignments` DROP COLUMN `completed`;--> statement-breakpoint
UPDATE `tasks` SET `status` = 'pending' WHERE `status` NOT IN ('pending', 'done');
