CREATE TABLE `agent_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`agent_id` text,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `agent_invocations` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`trigger_ref_id` text,
	`agent_id` text NOT NULL,
	`session_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`model` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`error` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`invocation_id` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`context_type` text,
	`context_id` text,
	`title` text,
	`created_at` text NOT NULL,
	`last_message_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`emoji` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`focus` text DEFAULT 'steady' NOT NULL,
	`focus_icon` text NOT NULL,
	`timeline` text,
	`story` text,
	`sort_order` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goals_name_unique` ON `goals` (`name`);--> statement-breakpoint
CREATE TABLE `initiatives` (
	`id` text PRIMARY KEY NOT NULL,
	`emoji` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`goal_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`mission` text,
	`sort_order` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `initiatives_name_unique` ON `initiatives` (`name`);--> statement-breakpoint
CREATE TABLE `requirement_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`description` text NOT NULL,
	`passed` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `task_requirements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `schedule_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`week_plan_id` text NOT NULL,
	`date` text NOT NULL,
	`time` text NOT NULL,
	`datetime` text NOT NULL,
	`type` text DEFAULT 'flex' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`agent_assignment_id` text,
	`goal_id` text,
	`note` text,
	`day_of_week` text NOT NULL,
	FOREIGN KEY (`week_plan_id`) REFERENCES `week_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_assignment_id`) REFERENCES `agent_assignments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `slot_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`slot_id` text NOT NULL,
	`label` text NOT NULL,
	`url` text,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`slot_id`) REFERENCES `schedule_slots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`description` text NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`display_name` text NOT NULL,
	`initiative_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`objective` text NOT NULL,
	`summary` text,
	`sort_order` integer DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`initiative_id`) REFERENCES `initiatives`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_name_unique` ON `tasks` (`name`);--> statement-breakpoint
CREATE TABLE `tool_call_log` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`invocation_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`is_error` integer DEFAULT false NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	FOREIGN KEY (`message_id`) REFERENCES `chat_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `week_goal_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`week_plan_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`target_slots` integer NOT NULL,
	`assigned_slots` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`week_plan_id`) REFERENCES `week_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `week_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`week_end` text NOT NULL,
	`generated_at` text NOT NULL,
	`sprint_slots` integer NOT NULL,
	`steady_slots` integer NOT NULL,
	`simmer_slots` integer NOT NULL,
	`fixed_slots` integer NOT NULL,
	`flex_slots` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `week_plans_week_start_unique` ON `week_plans` (`week_start`);