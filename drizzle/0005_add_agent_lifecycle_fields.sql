ALTER TABLE `nodes` ADD `agent_version` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `xray_version` text;--> statement-breakpoint
ALTER TABLE `nodes` ADD `pending_delete` integer NOT NULL DEFAULT 0;
