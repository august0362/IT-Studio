CREATE TABLE `revenue_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`amount_micro_usd` integer NOT NULL,
	`entered_currency` text NOT NULL,
	`description` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `revenue_entries_project_occurred_idx` ON `revenue_entries` (`project_id`,`occurred_at`);