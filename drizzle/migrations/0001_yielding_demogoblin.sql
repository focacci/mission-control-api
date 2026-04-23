CREATE TABLE `briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`title` text,
	`body` text,
	`references` text,
	`invocation_id` text,
	`generated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `briefs_date_kind_unique` ON `briefs` (`date`,`kind`);--> statement-breakpoint
CREATE TABLE `context_group_members` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`context_type` text NOT NULL,
	`context_id` text,
	`label` text NOT NULL,
	`icon` text NOT NULL,
	`type_name` text NOT NULL,
	`payload` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `context_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `context_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text DEFAULT 'point.3.connected.trianglepath.dotted' NOT NULL,
	`summary` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pinned_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`context_type` text NOT NULL,
	`context_id` text,
	`label` text NOT NULL,
	`icon` text NOT NULL,
	`type_name` text NOT NULL,
	`payload` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`label` text NOT NULL,
	`detail` text,
	`confidence` text DEFAULT 'observed' NOT NULL,
	`source` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `profile_sections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `profile_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`icon` text NOT NULL,
	`summary` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
