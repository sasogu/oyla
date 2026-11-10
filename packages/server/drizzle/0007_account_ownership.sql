CREATE TABLE `presentation_owners` (
	`presentation_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `presentation_owners_owner_idx` ON `presentation_owners` (`owner_id`);