CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`purpose` text NOT NULL,
	`model_key` text NOT NULL,
	`llm_request_id` text,
	`pipeline_run_id` text,
	`conversation_id` text,
	`usage_json` text NOT NULL,
	`image_count` integer,
	`cost_micro_usd` integer NOT NULL,
	`price_table_version` text NOT NULL,
	`billed_failure` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_project_occurred_idx` ON `ledger_entries` (`project_id`,`occurred_at`);