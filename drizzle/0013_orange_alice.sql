CREATE TABLE `line_protocols` (
	`line_id` integer NOT NULL,
	`protocol` text NOT NULL,
	`port` integer,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`line_id`, `protocol`),
	FOREIGN KEY (`line_id`) REFERENCES `lines`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `node_protocols` (
	`node_id` integer NOT NULL,
	`protocol` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`node_id`, `protocol`),
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `lines` DROP COLUMN `xray_port`;--> statement-breakpoint
ALTER TABLE `lines` DROP COLUMN `socks5_port`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `xray_protocol`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `xray_transport`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `xray_port`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `xray_config`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `xray_ws_path`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `xray_tls_domain`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `xray_tls_cert`;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `xray_tls_key`;