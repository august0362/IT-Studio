CREATE TABLE `budget_alerts` (
	`project_id` text NOT NULL,
	`period` text NOT NULL,
	`window_key` text NOT NULL,
	`threshold` real NOT NULL,
	`alerted_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `period`, `window_key`, `threshold`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`project_id` text NOT NULL,
	`period` text NOT NULL,
	`limit_micro_usd` integer NOT NULL,
	`warn_at_json` text NOT NULL,
	PRIMARY KEY(`project_id`, `period`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
