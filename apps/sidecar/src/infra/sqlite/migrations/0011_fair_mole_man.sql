CREATE TABLE `secret_history` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`hint` text NOT NULL,
	`action` text NOT NULL,
	`result_code` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `secret_history_at_idx` ON `secret_history` (`at`,`id`);