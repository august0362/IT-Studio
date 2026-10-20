CREATE TABLE `price_tables` (
	`version` text PRIMARY KEY NOT NULL,
	`effective_from` text NOT NULL,
	`origin` text NOT NULL,
	`entries_json` text NOT NULL
);
