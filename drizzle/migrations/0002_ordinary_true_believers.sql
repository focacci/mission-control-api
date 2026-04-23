PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tool_call_log` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`invocation_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`is_error` integer DEFAULT false NOT NULL,
	`summary` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_tool_call_log`("id", "message_id", "invocation_id", "tool_name", "input", "output", "is_error", "summary", "started_at", "ended_at", "duration_ms") SELECT "id", "message_id", "invocation_id", "tool_name", "input", "output", "is_error", NULL, "started_at", "ended_at", "duration_ms" FROM `tool_call_log`;--> statement-breakpoint
DROP TABLE `tool_call_log`;--> statement-breakpoint
ALTER TABLE `__new_tool_call_log` RENAME TO `tool_call_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `agent_invocations` ADD `gateway_run_id` text;