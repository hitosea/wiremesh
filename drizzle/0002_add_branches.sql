CREATE TABLE `line_branches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`line_id` integer NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE TABLE `branch_filters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`branch_id` integer NOT NULL,
	`filter_id` integer NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `line_branches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`filter_id`) REFERENCES `filters`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
ALTER TABLE `line_nodes` ADD `branch_id` integer REFERENCES `line_branches`(`id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `line_tunnels` ADD `branch_id` integer REFERENCES `line_branches`(`id`) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `filters` ADD `domain_rules` text;--> statement-breakpoint
ALTER TABLE `filters` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `filters` ADD `source_updated_at` text;--> statement-breakpoint
DROP TABLE IF EXISTS `line_filters`;
