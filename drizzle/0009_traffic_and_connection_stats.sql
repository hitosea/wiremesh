ALTER TABLE `node_status` ADD `forward_upload_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `node_status` ADD `forward_download_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `connection_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `active_ips` text;
