CREATE TABLE `image_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`prompt` text NOT NULL,
	`revised_prompt` text,
	`size` text NOT NULL,
	`mime_type` text NOT NULL,
	`local_path` text NOT NULL,
	`cost` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `image_assets_project_created_idx` ON `image_assets` (`project_id`,`created_at`);