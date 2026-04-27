PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text,
	`initiative_id` text,
	`task_id` text,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`agent_id` text,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_agent_assignments`("id", "goal_id", "initiative_id", "task_id", "title", "instructions", "agent_id", "completed", "completed_at", "sort_order", "created_at", "updated_at") SELECT "id", NULL, NULL, "task_id", "title", "instructions", "agent_id", "completed", "completed_at", "sort_order", "created_at", "updated_at" FROM `agent_assignments`;--> statement-breakpoint
DROP TABLE `agent_assignments`;--> statement-breakpoint
ALTER TABLE `__new_agent_assignments` RENAME TO `agent_assignments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;