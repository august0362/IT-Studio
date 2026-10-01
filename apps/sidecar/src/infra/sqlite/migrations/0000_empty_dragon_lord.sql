CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`workspace_root` text NOT NULL,
	`created_at` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_workspace_root_unique` ON `projects` (`workspace_root`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`json` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_singleton_id" CHECK("settings"."id" = 1)
);
