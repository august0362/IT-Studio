CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`prompt` text NOT NULL,
	`stage` text NOT NULL,
	`artifacts_json` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pipeline_runs_project_started_idx` ON `pipeline_runs` (`project_id`,`started_at`);