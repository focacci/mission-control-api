ALTER TABLE `briefs` ADD COLUMN `reveal_at` text;--> statement-breakpoint
ALTER TABLE `briefs` ADD COLUMN `window_start` text;--> statement-breakpoint
ALTER TABLE `briefs` ADD COLUMN `window_end` text;--> statement-breakpoint
ALTER TABLE `briefs` ADD COLUMN `acknowledged_at` text;--> statement-breakpoint
UPDATE `briefs` SET `status` = 'drafting' WHERE `status` = 'generating';
