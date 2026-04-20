CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`identity_name` text,
	`identity_emoji` text,
	`workspace` text NOT NULL,
	`agent_dir` text NOT NULL,
	`model` text,
	`bindings` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`system_prompt` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
