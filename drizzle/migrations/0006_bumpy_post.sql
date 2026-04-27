CREATE TABLE `agent_output_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`output_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text,
	`tool_name` text,
	`tool_input` text,
	`tool_output` text,
	`is_error` integer DEFAULT false NOT NULL,
	`sort_order` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`duration_ms` integer,
	FOREIGN KEY (`output_id`) REFERENCES `agent_outputs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_assignment_id` text NOT NULL,
	`agent_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`input` text NOT NULL,
	`response` text,
	`model` text,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`error` text,
	FOREIGN KEY (`agent_assignment_id`) REFERENCES `agent_assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
