CREATE TABLE `orch_runs` (`id` text PRIMARY KEY NOT NULL, `project_id` text NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE, `state` text NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL);
CREATE INDEX `orch_runs_project_updated_idx` ON `orch_runs` (`project_id`,`updated_at`);
CREATE TABLE `orch_tasks` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `orch_runs`(`id`) ON DELETE CASCADE, `state` text NOT NULL, `data_json` text NOT NULL);
CREATE INDEX `orch_tasks_run_idx` ON `orch_tasks` (`run_id`);
CREATE TABLE `orch_attempts` (`id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL REFERENCES `orch_runs`(`id`) ON DELETE CASCADE, `task_id` text, `state` text NOT NULL, `data_json` text NOT NULL);
CREATE INDEX `orch_attempts_run_idx` ON `orch_attempts` (`run_id`);
CREATE TABLE `orch_events` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `run_id` text NOT NULL REFERENCES `orch_runs`(`id`) ON DELETE CASCADE, `type` text NOT NULL, `data_json` text NOT NULL, `created_at` text NOT NULL);
CREATE INDEX `orch_events_run_idx` ON `orch_events` (`run_id`,`id`);
