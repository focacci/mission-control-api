ALTER TABLE `chat_messages` ADD `parts` text;
--> statement-breakpoint
UPDATE `chat_messages`
   SET `parts` = json_array(json_object('kind', 'text', 'text', `content`))
 WHERE `parts` IS NULL;