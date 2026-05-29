ALTER TABLE `nodes` ADD `xray_cert_mode` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
UPDATE `nodes` SET `xray_cert_mode` = 'auto' WHERE `xray_transport` = 'ws-tls' AND `xray_tls_cert` IS NULL;
