CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`module_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`event_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_events_project_occurred_idx` ON `activity_events` (`project_id`,`occurred_at`);