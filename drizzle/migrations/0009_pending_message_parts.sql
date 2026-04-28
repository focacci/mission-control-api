CREATE TABLE `pending_message_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`invocation_id` text NOT NULL,
	`session_id` text NOT NULL,
	`part` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pending_parts_invocation_idx` ON `pending_message_parts` (`invocation_id`,`sort_order`);
