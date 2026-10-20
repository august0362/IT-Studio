CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`source_path` text NOT NULL,
	`format` text NOT NULL,
	`content_hash` text NOT NULL,
	`chunk_count` integer NOT NULL,
	`embedding_model` text NOT NULL,
	`embedding_dimensions` integer NOT NULL,
	`ingested_at` text NOT NULL,
	`tags_json` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_project_source_unique` ON `documents` (`project_id`,`source_path`);