CREATE TABLE `processes` (
  `row_order` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `id` text NOT NULL,
  `project_id` text,
  `status` text NOT NULL,
  `updated_at` text NOT NULL,
  `record_json` text NOT NULL,
  `operation_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `processes_id_unique` ON `processes` (`id`);
--> statement-breakpoint
CREATE INDEX `processes_status_updated_idx` ON `processes` (`status`, `updated_at`);
