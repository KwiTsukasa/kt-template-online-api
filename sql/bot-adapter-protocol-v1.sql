-- Bot Adapter / Plugin Platform 表名与 Tencent 官方绑定迁移。
-- DDL 会隐式提交，因此本脚本用失败关闭校验代替伪事务：只有旧表全部数据已进入新表后才删除旧表。

SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS `kt_normalize_bot_index_names`;
DROP PROCEDURE IF EXISTS `kt_migrate_bot_table`;
DROP PROCEDURE IF EXISTS `kt_migrate_tencent_plugin_binding`;
DROP PROCEDURE IF EXISTS `kt_migrate_bot_subscription_key`;
DROP PROCEDURE IF EXISTS `kt_retire_legacy_message_tables`;
DROP PROCEDURE IF EXISTS `kt_migrate_bot_adapter_protocol_v1`;

DELIMITER $$

CREATE PROCEDURE `kt_normalize_bot_index_names`(
  IN canonical_table VARCHAR(64)
)
BEGIN
  DECLARE finished INT DEFAULT 0;
  DECLARE legacy_index VARCHAR(64);
  DECLARE canonical_index VARCHAR(64);
  DECLARE canonical_index_exists INT DEFAULT 0;
  DECLARE index_cursor CURSOR FOR
    SELECT DISTINCT `index_name`
    FROM `information_schema`.`statistics`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = canonical_table
      AND `index_name` LIKE '%qqbot%';
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET finished = 1;

  OPEN index_cursor;

  index_loop: LOOP
    FETCH index_cursor INTO legacy_index;
    IF finished = 1 THEN
      LEAVE index_loop;
    END IF;

    IF canonical_table = 'napcat_webui_gateway_audit' THEN
      SET canonical_index = REPLACE(
        legacy_index,
        'qqbot_napcat',
        'napcat'
      );
    ELSEIF canonical_table = 'plugin'
      OR LEFT(canonical_table, 7) = 'plugin_' THEN
      SET canonical_index = REPLACE(
        legacy_index,
        'qqbot_plugin',
        'plugin'
      );
    ELSE
      SET canonical_index = REPLACE(legacy_index, 'qqbot', 'bot');
    END IF;

    SELECT COUNT(*) INTO canonical_index_exists
    FROM `information_schema`.`statistics`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = canonical_table
      AND `index_name` = canonical_index;

    IF canonical_index_exists = 0 THEN
      SET @kt_bot_sql = CONCAT(
        'ALTER TABLE `',
        canonical_table,
        '` RENAME INDEX `',
        legacy_index,
        '` TO `',
        canonical_index,
        '`'
      );
    ELSE
      SET @kt_bot_sql = CONCAT(
        'ALTER TABLE `',
        canonical_table,
        '` DROP INDEX `',
        legacy_index,
        '`'
      );
    END IF;

    PREPARE kt_bot_stmt FROM @kt_bot_sql;
    EXECUTE kt_bot_stmt;
    DEALLOCATE PREPARE kt_bot_stmt;
  END LOOP;

  CLOSE index_cursor;
END$$

CREATE PROCEDURE `kt_migrate_bot_table`(
  IN legacy_table VARCHAR(64),
  IN canonical_table VARCHAR(64)
)
migration: BEGIN
  DECLARE legacy_exists INT DEFAULT 0;
  DECLARE canonical_exists INT DEFAULT 0;
  DECLARE legacy_id_exists INT DEFAULT 0;
  DECLARE canonical_id_exists INT DEFAULT 0;
  DECLARE legacy_only_columns INT DEFAULT 0;
  DECLARE required_canonical_columns INT DEFAULT 0;
  DECLARE common_columns LONGTEXT;
  DECLARE difference_predicate LONGTEXT;
  DECLARE error_message VARCHAR(128);

  IF legacy_table NOT REGEXP '^[a-z0-9_]+$'
    OR canonical_table NOT REGEXP '^[a-z0-9_]+$' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Bot table migration received an unsafe identifier';
  END IF;

  SELECT COUNT(*) INTO legacy_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = legacy_table
    AND `table_type` = 'BASE TABLE';

  SELECT COUNT(*) INTO canonical_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = canonical_table
    AND `table_type` = 'BASE TABLE';

  IF legacy_exists = 0 THEN
    IF canonical_exists = 1 THEN
      CALL `kt_normalize_bot_index_names`(canonical_table);
    END IF;
    LEAVE migration;
  END IF;

  IF canonical_exists = 0 THEN
    SET @kt_bot_sql = CONCAT(
      'RENAME TABLE `',
      legacy_table,
      '` TO `',
      canonical_table,
      '`'
    );
    PREPARE kt_bot_stmt FROM @kt_bot_sql;
    EXECUTE kt_bot_stmt;
    DEALLOCATE PREPARE kt_bot_stmt;
    CALL `kt_normalize_bot_index_names`(canonical_table);
    LEAVE migration;
  END IF;

  SELECT COUNT(*) INTO legacy_id_exists
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = legacy_table
    AND `column_name` = 'id';

  SELECT COUNT(*) INTO canonical_id_exists
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = canonical_table
    AND `column_name` = 'id';

  IF legacy_id_exists = 0 OR canonical_id_exists = 0 THEN
    SET error_message = CONCAT(
      'Bot table merge requires id: ',
      legacy_table,
      ' -> ',
      canonical_table
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_message;
  END IF;

  SELECT COUNT(*) INTO legacy_only_columns
  FROM `information_schema`.`columns` AS `legacy_column`
  LEFT JOIN `information_schema`.`columns` AS `canonical_column`
    ON `canonical_column`.`table_schema` = `legacy_column`.`table_schema`
    AND `canonical_column`.`table_name` = canonical_table
    AND `canonical_column`.`column_name` = `legacy_column`.`column_name`
  WHERE `legacy_column`.`table_schema` = DATABASE()
    AND `legacy_column`.`table_name` = legacy_table
    AND `legacy_column`.`extra` NOT LIKE '%GENERATED%'
    AND `canonical_column`.`column_name` IS NULL;

  IF legacy_only_columns > 0 THEN
    SET error_message = CONCAT(
      'Canonical table lacks legacy columns: ',
      legacy_table
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_message;
  END IF;

  SELECT COUNT(*) INTO required_canonical_columns
  FROM `information_schema`.`columns` AS `canonical_column`
  LEFT JOIN `information_schema`.`columns` AS `legacy_column`
    ON `legacy_column`.`table_schema` = `canonical_column`.`table_schema`
    AND `legacy_column`.`table_name` = legacy_table
    AND `legacy_column`.`column_name` = `canonical_column`.`column_name`
  WHERE `canonical_column`.`table_schema` = DATABASE()
    AND `canonical_column`.`table_name` = canonical_table
    AND `canonical_column`.`extra` NOT LIKE '%GENERATED%'
    AND `canonical_column`.`extra` NOT LIKE '%auto_increment%'
    AND `canonical_column`.`is_nullable` = 'NO'
    AND `canonical_column`.`column_default` IS NULL
    AND `legacy_column`.`column_name` IS NULL;

  IF required_canonical_columns > 0 THEN
    SET error_message = CONCAT(
      'Legacy table lacks required target columns: ',
      canonical_table
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_message;
  END IF;

  SELECT GROUP_CONCAT(
    CONCAT('`', `legacy_column`.`column_name`, '`')
    ORDER BY `legacy_column`.`ordinal_position`
    SEPARATOR ','
  ) INTO common_columns
  FROM `information_schema`.`columns` AS `legacy_column`
  INNER JOIN `information_schema`.`columns` AS `canonical_column`
    ON `canonical_column`.`table_schema` = `legacy_column`.`table_schema`
    AND `canonical_column`.`table_name` = canonical_table
    AND `canonical_column`.`column_name` = `legacy_column`.`column_name`
  WHERE `legacy_column`.`table_schema` = DATABASE()
    AND `legacy_column`.`table_name` = legacy_table
    AND `legacy_column`.`extra` NOT LIKE '%GENERATED%'
    AND `canonical_column`.`extra` NOT LIKE '%GENERATED%';

  SELECT GROUP_CONCAT(
    CONCAT(
      'NOT (`canonical`.`',
      `legacy_column`.`column_name`,
      '` <=> `legacy`.`',
      `legacy_column`.`column_name`,
      '`)'
    )
    ORDER BY `legacy_column`.`ordinal_position`
    SEPARATOR ' OR '
  ) INTO difference_predicate
  FROM `information_schema`.`columns` AS `legacy_column`
  INNER JOIN `information_schema`.`columns` AS `canonical_column`
    ON `canonical_column`.`table_schema` = `legacy_column`.`table_schema`
    AND `canonical_column`.`table_name` = canonical_table
    AND `canonical_column`.`column_name` = `legacy_column`.`column_name`
  WHERE `legacy_column`.`table_schema` = DATABASE()
    AND `legacy_column`.`table_name` = legacy_table
    AND `legacy_column`.`extra` NOT LIKE '%GENERATED%'
    AND `canonical_column`.`extra` NOT LIKE '%GENERATED%';

  IF common_columns IS NULL OR difference_predicate IS NULL THEN
    SET error_message = CONCAT(
      'Bot table merge has no common columns: ',
      legacy_table
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_message;
  END IF;

  SET @kt_bot_sql = CONCAT(
    'INSERT IGNORE INTO `',
    canonical_table,
    '` (',
    common_columns,
    ') SELECT ',
    common_columns,
    ' FROM `',
    legacy_table,
    '`'
  );
  PREPARE kt_bot_stmt FROM @kt_bot_sql;
  EXECUTE kt_bot_stmt;
  DEALLOCATE PREPARE kt_bot_stmt;

  SET @kt_bot_missing_rows = 0;
  SET @kt_bot_sql = CONCAT(
    'SELECT COUNT(*) INTO @kt_bot_missing_rows FROM `',
    legacy_table,
    '` AS `legacy` LEFT JOIN `',
    canonical_table,
    '` AS `canonical` ON `canonical`.`id` = `legacy`.`id` ',
    'WHERE `canonical`.`id` IS NULL'
  );
  PREPARE kt_bot_stmt FROM @kt_bot_sql;
  EXECUTE kt_bot_stmt;
  DEALLOCATE PREPARE kt_bot_stmt;

  IF @kt_bot_missing_rows > 0 THEN
    SET error_message = CONCAT(
      'Bot table merge has key conflicts: ',
      legacy_table
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_message;
  END IF;

  SET @kt_bot_conflicting_rows = 0;
  SET @kt_bot_sql = CONCAT(
    'SELECT COUNT(*) INTO @kt_bot_conflicting_rows FROM `',
    legacy_table,
    '` AS `legacy` INNER JOIN `',
    canonical_table,
    '` AS `canonical` ON `canonical`.`id` = `legacy`.`id` WHERE ',
    difference_predicate
  );
  PREPARE kt_bot_stmt FROM @kt_bot_sql;
  EXECUTE kt_bot_stmt;
  DEALLOCATE PREPARE kt_bot_stmt;

  IF @kt_bot_conflicting_rows > 0 THEN
    SET error_message = CONCAT(
      'Bot table merge has divergent rows: ',
      legacy_table
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_message;
  END IF;

  SET @kt_bot_sql = CONCAT('DROP TABLE `', legacy_table, '`');
  PREPARE kt_bot_stmt FROM @kt_bot_sql;
  EXECUTE kt_bot_stmt;
  DEALLOCATE PREPARE kt_bot_stmt;

  CALL `kt_normalize_bot_index_names`(canonical_table);
END$$

CREATE PROCEDURE `kt_migrate_tencent_plugin_binding`()
binding_migration: BEGIN
  DECLARE legacy_binding_exists INT DEFAULT 0;
  DECLARE bot_account_exists INT DEFAULT 0;
  DECLARE bot_ability_exists INT DEFAULT 0;
  DECLARE plugin_exists INT DEFAULT 0;
  DECLARE plugin_event_handler_exists INT DEFAULT 0;
  DECLARE connection_mode_exists INT DEFAULT 0;
  DECLARE legacy_binding_rows BIGINT DEFAULT 0;

  SELECT COUNT(*) INTO legacy_binding_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'qqbot_plugin_account_binding'
    AND `table_type` = 'BASE TABLE';

  IF legacy_binding_exists = 0 THEN
    LEAVE binding_migration;
  END IF;

  SELECT COUNT(*) INTO bot_account_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'bot_account'
    AND `table_type` = 'BASE TABLE';

  SELECT COUNT(*) INTO plugin_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'plugin'
    AND `table_type` = 'BASE TABLE';

  IF bot_account_exists = 0 OR plugin_exists = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Legacy plugin binding requires bot_account and plugin';
  END IF;

  SELECT COUNT(*) INTO connection_mode_exists
  FROM `information_schema`.`columns`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'bot_account'
    AND `column_name` = 'connection_mode';

  SELECT COUNT(*) INTO legacy_binding_rows
  FROM `qqbot_plugin_account_binding`;

  IF connection_mode_exists = 0 AND legacy_binding_rows > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Legacy plugin binding requires bot_account.connection_mode';
  END IF;

  IF connection_mode_exists = 1 THEN
    INSERT IGNORE INTO `tencent_bot_plugin_binding` (
      `id`,
      `account_id`,
      `plugin_key`,
      `enabled`,
      `create_time`,
      `update_time`
    )
    SELECT
      `binding`.`id`,
      `binding`.`account_id`,
      `plugin`.`plugin_key`,
      `binding`.`enabled`,
      `binding`.`create_time`,
      `binding`.`create_time`
    FROM `qqbot_plugin_account_binding` AS `binding`
    INNER JOIN `bot_account` AS `account`
      ON `account`.`id` = `binding`.`account_id`
      AND `account`.`connection_mode` IN (
        'official-websocket',
        'official-webhook'
      )
    INNER JOIN `plugin` AS `plugin`
      ON `plugin`.`id` = `binding`.`plugin_id`;

    SELECT COUNT(*) INTO @kt_tencent_binding_missing
    FROM `qqbot_plugin_account_binding` AS `binding`
    INNER JOIN `bot_account` AS `account`
      ON `account`.`id` = `binding`.`account_id`
      AND `account`.`connection_mode` IN (
        'official-websocket',
        'official-webhook'
      )
    INNER JOIN `plugin` AS `plugin`
      ON `plugin`.`id` = `binding`.`plugin_id`
    LEFT JOIN `tencent_bot_plugin_binding` AS `canonical_binding`
      ON `canonical_binding`.`account_id` = `binding`.`account_id`
      AND `canonical_binding`.`plugin_key` = `plugin`.`plugin_key`
    WHERE `canonical_binding`.`id` IS NULL;

    IF @kt_tencent_binding_missing > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Tencent plugin binding migration is incomplete';
    END IF;

    SELECT COUNT(*) INTO bot_ability_exists
    FROM `information_schema`.`tables`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'bot_account_ability'
      AND `table_type` = 'BASE TABLE';

    SELECT COUNT(*) INTO plugin_event_handler_exists
    FROM `information_schema`.`tables`
    WHERE `table_schema` = DATABASE()
      AND `table_name` = 'plugin_event_handler'
      AND `table_type` = 'BASE TABLE';

    IF bot_ability_exists = 0 AND plugin_event_handler_exists = 1 THEN
      SELECT COUNT(*) INTO @kt_napcat_binding_without_ability_table
      FROM `qqbot_plugin_account_binding` AS `binding`
      INNER JOIN `bot_account` AS `account`
        ON `account`.`id` = `binding`.`account_id`
        AND `account`.`connection_mode` = 'reverse-ws'
      INNER JOIN `plugin_event_handler` AS `event_handler`
        ON `event_handler`.`plugin_id` = `binding`.`plugin_id`
        AND `event_handler`.`enabled` = 1;

      IF @kt_napcat_binding_without_ability_table > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'NapCat binding requires bot_account_ability';
      END IF;
    END IF;

    IF bot_ability_exists = 1 AND plugin_event_handler_exists = 1 THEN
      UPDATE `bot_account_ability` AS `ability`
      INNER JOIN `qqbot_plugin_account_binding` AS `binding`
        ON `binding`.`account_id` = `ability`.`account_id`
      INNER JOIN `bot_account` AS `account`
        ON `account`.`id` = `binding`.`account_id`
        AND `account`.`connection_mode` = 'reverse-ws'
      INNER JOIN `plugin` AS `plugin`
        ON `plugin`.`id` = `binding`.`plugin_id`
        AND `plugin`.`plugin_key` = `ability`.`ability_key`
      INNER JOIN `plugin_event_handler` AS `event_handler`
        ON `event_handler`.`plugin_id` = `plugin`.`id`
        AND `event_handler`.`enabled` = 1
      SET `ability`.`is_deleted` = IF(`binding`.`enabled` = 1, 0, 1),
          `ability`.`update_time` = CURRENT_TIMESTAMP
      WHERE `ability`.`ability_type` = 'event_plugin';

      INSERT IGNORE INTO `bot_account_ability` (
        `id`,
        `account_id`,
        `self_id`,
        `ability_type`,
        `ability_key`,
        `is_deleted`,
        `create_time`,
        `update_time`
      )
      SELECT
        CAST(
          (
            UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000 - 1288834974657
          ) * 4194304
          + 390000
          + ROW_NUMBER() OVER (
            ORDER BY `candidate`.`account_id`, `candidate`.`plugin_key`
          )
          AS UNSIGNED
        ),
        `candidate`.`account_id`,
        `candidate`.`self_id`,
        'event_plugin',
        `candidate`.`plugin_key`,
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM (
        SELECT DISTINCT
          `binding`.`account_id`,
          `account`.`self_id`,
          `plugin`.`plugin_key`
        FROM `qqbot_plugin_account_binding` AS `binding`
        INNER JOIN `bot_account` AS `account`
          ON `account`.`id` = `binding`.`account_id`
          AND `account`.`connection_mode` = 'reverse-ws'
        INNER JOIN `plugin` AS `plugin`
          ON `plugin`.`id` = `binding`.`plugin_id`
        INNER JOIN `plugin_event_handler` AS `event_handler`
          ON `event_handler`.`plugin_id` = `plugin`.`id`
          AND `event_handler`.`enabled` = 1
        WHERE `binding`.`enabled` = 1
      ) AS `candidate`;

      SELECT COUNT(*) INTO @kt_napcat_binding_mismatch
      FROM `qqbot_plugin_account_binding` AS `binding`
      INNER JOIN `bot_account` AS `account`
        ON `account`.`id` = `binding`.`account_id`
        AND `account`.`connection_mode` = 'reverse-ws'
      INNER JOIN `plugin` AS `plugin`
        ON `plugin`.`id` = `binding`.`plugin_id`
      INNER JOIN `plugin_event_handler` AS `event_handler`
        ON `event_handler`.`plugin_id` = `plugin`.`id`
        AND `event_handler`.`enabled` = 1
      LEFT JOIN `bot_account_ability` AS `ability`
        ON `ability`.`account_id` = `binding`.`account_id`
        AND `ability`.`ability_type` = 'event_plugin'
        AND `ability`.`ability_key` = `plugin`.`plugin_key`
      WHERE (`binding`.`enabled` = 1 AND (
          `ability`.`id` IS NULL OR `ability`.`is_deleted` <> 0
        ))
        OR (`binding`.`enabled` = 0 AND (
          `ability`.`id` IS NOT NULL AND `ability`.`is_deleted` = 0
        ));

      IF @kt_napcat_binding_mismatch > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'NapCat event plugin binding migration is incomplete';
      END IF;
    END IF;
  END IF;

  -- Tencent 绑定进入专属表；NapCat 事件绑定进入账号能力，插件平台不再保存 Bot 身份。
  DROP TABLE `qqbot_plugin_account_binding`;
END$$

CREATE PROCEDURE `kt_migrate_bot_subscription_key`()
subscription_migration: BEGIN
  DECLARE subscription_exists INT DEFAULT 0;
  DECLARE template_binding_exists INT DEFAULT 0;
  DECLARE publish_binding_exists INT DEFAULT 0;
  DECLARE delivery_exists INT DEFAULT 0;
  DECLARE station_binding_exists INT DEFAULT 0;
  DECLARE missing_template_rows BIGINT DEFAULT 0;

  SELECT COUNT(*) INTO subscription_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'message_subscription'
    AND `table_type` = 'BASE TABLE';

  IF subscription_exists = 0 THEN
    LEAVE subscription_migration;
  END IF;

  DROP TEMPORARY TABLE IF EXISTS `bot_subscription_key_conflict`;
  CREATE TEMPORARY TABLE `bot_subscription_key_conflict` (
    `legacy_id` BIGINT NOT NULL,
    `canonical_id` BIGINT NOT NULL,
    PRIMARY KEY (`legacy_id`),
    KEY `idx_bot_subscription_key_conflict_canonical` (`canonical_id`)
  ) ENGINE=InnoDB;

  INSERT INTO `bot_subscription_key_conflict` (
    `legacy_id`,
    `canonical_id`
  )
  SELECT
    `legacy`.`id`,
    `canonical`.`id`
  FROM `message_subscription` AS `legacy`
  INNER JOIN `message_subscription` AS `canonical`
    ON `canonical`.`id` <> `legacy`.`id`
    AND `canonical`.`subscriber_key` = 'bot'
    AND `canonical`.`active_key` = CONCAT(
      'bot:',
      SUBSTRING(`legacy`.`active_key`, 7)
    )
  WHERE `legacy`.`active_key` LIKE 'qqbot:%';

  SELECT COUNT(*) INTO template_binding_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'message_subscription_template'
    AND `table_type` = 'BASE TABLE';

  IF template_binding_exists = 1 THEN
    INSERT IGNORE INTO `message_subscription_template` (
      `subscription_id`,
      `template_id`,
      `sort_order`
    )
    SELECT
      `mapping`.`canonical_id`,
      `legacy_template`.`template_id`,
      `legacy_template`.`sort_order`
    FROM `bot_subscription_key_conflict` AS `mapping`
    INNER JOIN `message_subscription_template` AS `legacy_template`
      ON `legacy_template`.`subscription_id` = `mapping`.`legacy_id`;

    SELECT COUNT(*) INTO missing_template_rows
    FROM `bot_subscription_key_conflict` AS `mapping`
    INNER JOIN `message_subscription_template` AS `legacy_template`
      ON `legacy_template`.`subscription_id` = `mapping`.`legacy_id`
    LEFT JOIN `message_subscription_template` AS `canonical_template`
      ON `canonical_template`.`subscription_id` = `mapping`.`canonical_id`
      AND `canonical_template`.`template_id` = `legacy_template`.`template_id`
    WHERE `canonical_template`.`subscription_id` IS NULL;

    IF missing_template_rows > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Bot subscription template merge has conflicts';
    END IF;
  END IF;

  SELECT COUNT(*) INTO publish_binding_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'bot_message_publish_binding'
    AND `table_type` = 'BASE TABLE';

  IF publish_binding_exists = 1 THEN
    UPDATE `bot_message_publish_binding` AS `binding`
    INNER JOIN `bot_subscription_key_conflict` AS `mapping`
      ON `mapping`.`legacy_id` = `binding`.`subscription_id`
    SET `binding`.`subscription_id` = `mapping`.`canonical_id`;
  END IF;

  SELECT COUNT(*) INTO delivery_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'bot_message_delivery'
    AND `table_type` = 'BASE TABLE';

  IF delivery_exists = 1 THEN
    UPDATE `bot_message_delivery` AS `delivery`
    INNER JOIN `bot_subscription_key_conflict` AS `mapping`
      ON `mapping`.`legacy_id` = `delivery`.`subscription_id`
    SET `delivery`.`subscription_id` = `mapping`.`canonical_id`;
  END IF;

  SELECT COUNT(*) INTO station_binding_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'station_notice_message_binding'
    AND `table_type` = 'BASE TABLE';

  IF station_binding_exists = 1 THEN
    UPDATE `station_notice_message_binding` AS `binding`
    INNER JOIN `bot_subscription_key_conflict` AS `mapping`
      ON `mapping`.`legacy_id` = `binding`.`subscription_id`
    SET `binding`.`subscription_id` = `mapping`.`canonical_id`;
  END IF;

  IF template_binding_exists = 1 THEN
    DELETE `legacy_template`
    FROM `message_subscription_template` AS `legacy_template`
    INNER JOIN `bot_subscription_key_conflict` AS `mapping`
      ON `mapping`.`legacy_id` = `legacy_template`.`subscription_id`;
  END IF;

  DELETE `legacy`
  FROM `message_subscription` AS `legacy`
  INNER JOIN `bot_subscription_key_conflict` AS `mapping`
    ON `mapping`.`legacy_id` = `legacy`.`id`;

  UPDATE `message_subscription`
  SET `active_key` = CONCAT(
    'bot:',
    SUBSTRING(`active_key`, 7)
  )
  WHERE `active_key` LIKE 'qqbot:%';

  UPDATE `message_subscription`
  SET `subscriber_key` = 'bot'
  WHERE `subscriber_key` = 'qqbot';

  DROP TEMPORARY TABLE `bot_subscription_key_conflict`;
END$$

CREATE PROCEDURE `kt_retire_legacy_message_tables`()
message_retirement: BEGIN
  DECLARE legacy_template_exists INT DEFAULT 0;
  DECLARE legacy_subscription_exists INT DEFAULT 0;
  DECLARE legacy_event_exists INT DEFAULT 0;
  DECLARE canonical_template_exists INT DEFAULT 0;
  DECLARE canonical_subscription_exists INT DEFAULT 0;
  DECLARE canonical_event_exists INT DEFAULT 0;
  DECLARE legacy_rows BIGINT DEFAULT 0;
  DECLARE mismatch_rows BIGINT DEFAULT 0;

  SELECT COUNT(*) INTO legacy_template_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'qqbot_message_template'
    AND `table_type` = 'BASE TABLE';

  SELECT COUNT(*) INTO canonical_template_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'message_template'
    AND `table_type` = 'BASE TABLE';

  IF legacy_template_exists = 1 THEN
    SELECT COUNT(*) INTO legacy_rows FROM `qqbot_message_template`;
    IF legacy_rows > 0 AND canonical_template_exists = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Legacy message templates require message_template';
    END IF;
    IF legacy_rows > 0 THEN
      SELECT COUNT(*) INTO mismatch_rows
      FROM `qqbot_message_template` AS `legacy`
      LEFT JOIN `message_template` AS `canonical`
        ON `canonical`.`id` = `legacy`.`id`
      WHERE `canonical`.`id` IS NULL
        OR NOT (`canonical`.`name` <=> `legacy`.`name`)
        OR NOT (`canonical`.`source_key` <=> `legacy`.`source_key`)
        OR NOT (`canonical`.`content` <=> `legacy`.`content`)
        OR NOT (`canonical`.`enabled` <=> `legacy`.`enabled`)
        OR NOT (`canonical`.`remark` <=> `legacy`.`remark`)
        OR NOT (`canonical`.`is_deleted` <=> `legacy`.`is_deleted`)
        OR NOT (`canonical`.`create_time` <=> `legacy`.`create_time`)
        OR NOT (`canonical`.`update_time` <=> `legacy`.`update_time`);
      IF mismatch_rows > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Legacy message template retirement is incomplete';
      END IF;
    END IF;
  END IF;

  SELECT COUNT(*) INTO legacy_event_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'qqbot_message_event'
    AND `table_type` = 'BASE TABLE';

  SELECT COUNT(*) INTO canonical_event_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'message_event'
    AND `table_type` = 'BASE TABLE';

  IF legacy_event_exists = 1 THEN
    SELECT COUNT(*) INTO legacy_rows FROM `qqbot_message_event`;
    IF legacy_rows > 0 AND canonical_event_exists = 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Legacy message events require message_event';
    END IF;
    IF legacy_rows > 0 THEN
      SELECT COUNT(*) INTO mismatch_rows
      FROM `qqbot_message_event` AS `legacy`
      LEFT JOIN `message_event` AS `canonical`
        ON `canonical`.`id` = `legacy`.`id`
      WHERE `canonical`.`id` IS NULL
        OR NOT (`canonical`.`event_id` <=> `legacy`.`event_id`)
        OR NOT (`canonical`.`source_key` <=> `legacy`.`source_key`)
        OR NOT (`canonical`.`resource_key` <=> `legacy`.`resource_key`)
        OR NOT (`canonical`.`occurred_at` <=> `legacy`.`occurred_at`)
        OR NOT (`canonical`.`payload` <=> `legacy`.`payload`)
        OR NOT (`canonical`.`fanout_status` <=> `legacy`.`fanout_status`)
        OR NOT (`canonical`.`fanout_attempt_count` <=> `legacy`.`fanout_attempt_count`)
        OR NOT (`canonical`.`next_fanout_at` <=> `legacy`.`next_fanout_at`)
        OR NOT (`canonical`.`fanout_lease_until` <=> `legacy`.`fanout_lease_until`)
        OR NOT (`canonical`.`last_error_code` <=> `legacy`.`last_error_code`)
        OR NOT (`canonical`.`last_error_message` <=> `legacy`.`last_error_message`)
        OR NOT (`canonical`.`create_time` <=> `legacy`.`create_time`)
        OR NOT (`canonical`.`update_time` <=> `legacy`.`update_time`);
      IF mismatch_rows > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Legacy message event retirement is incomplete';
      END IF;
    END IF;
  END IF;

  SELECT COUNT(*) INTO legacy_subscription_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'qqbot_message_subscription'
    AND `table_type` = 'BASE TABLE';

  SELECT COUNT(*) INTO canonical_subscription_exists
  FROM `information_schema`.`tables`
  WHERE `table_schema` = DATABASE()
    AND `table_name` = 'message_subscription'
    AND `table_type` = 'BASE TABLE';

  IF legacy_subscription_exists = 1 THEN
    SELECT COUNT(*) INTO legacy_rows FROM `qqbot_message_subscription`;
    IF legacy_rows > 0 AND (
      canonical_subscription_exists = 0 OR canonical_template_exists = 0
    ) THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Legacy subscriptions require generic message tables';
    END IF;
    IF legacy_rows > 0 THEN
      SELECT COUNT(*) INTO mismatch_rows
      FROM `qqbot_message_subscription` AS `legacy`
      LEFT JOIN (
        SELECT DISTINCT
          `subscription`.`id`,
          `subscription`.`name`,
          `subscription`.`source_config`,
          `subscription`.`source_config_digest`,
          `subscription`.`enabled`,
          `subscription`.`remark`,
          `subscription`.`is_deleted`,
          `subscription`.`create_time`,
          `template`.`source_key`
        FROM `message_subscription` AS `subscription`
        INNER JOIN `message_subscription_template` AS `binding`
          ON `binding`.`subscription_id` = `subscription`.`id`
        INNER JOIN `message_template` AS `template`
          ON `template`.`id` = `binding`.`template_id`
      ) AS `canonical`
        ON `canonical`.`source_key` = `legacy`.`source_key`
        AND `canonical`.`name` = `legacy`.`name`
        AND (`canonical`.`source_config` <=> `legacy`.`source_config`)
        AND `canonical`.`source_config_digest` = `legacy`.`source_config_digest`
        AND `canonical`.`enabled` = `legacy`.`enabled`
        AND (`canonical`.`remark` <=> `legacy`.`remark`)
        AND `canonical`.`is_deleted` = `legacy`.`is_deleted`
        AND `canonical`.`create_time` = `legacy`.`create_time`
      WHERE `canonical`.`id` IS NULL;
      IF mismatch_rows > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Legacy message subscription retirement is incomplete';
      END IF;
    END IF;
  END IF;

  IF legacy_subscription_exists = 1 THEN
    DROP TABLE `qqbot_message_subscription`;
  END IF;
  IF legacy_event_exists = 1 THEN
    DROP TABLE `qqbot_message_event`;
  END IF;
  IF legacy_template_exists = 1 THEN
    DROP TABLE `qqbot_message_template`;
  END IF;
END$$

CREATE PROCEDURE `kt_migrate_bot_adapter_protocol_v1`()
BEGIN
  DECLARE previous_foreign_key_checks INT DEFAULT @@FOREIGN_KEY_CHECKS;
  DECLARE previous_group_concat_max_len BIGINT DEFAULT @@group_concat_max_len;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    SET FOREIGN_KEY_CHECKS = previous_foreign_key_checks;
    SET SESSION group_concat_max_len = previous_group_concat_max_len;
    RESIGNAL;
  END;

  SET FOREIGN_KEY_CHECKS = 0;
  SET SESSION group_concat_max_len = 65535;

  CALL `kt_migrate_bot_table`('qqbot_plugin_version', 'plugin_version');
  CALL `kt_migrate_bot_table`('qqbot_plugin_installation', 'plugin_installation');
  CALL `kt_migrate_bot_table`('qqbot_plugin_operation', 'plugin_operation');
  CALL `kt_migrate_bot_table`('qqbot_plugin_event_handler', 'plugin_event_handler');
  CALL `kt_migrate_bot_table`('qqbot_plugin_config', 'plugin_config');
  CALL `kt_migrate_bot_table`('qqbot_plugin_asset', 'plugin_asset');
  CALL `kt_migrate_bot_table`('qqbot_plugin_runtime_event', 'plugin_runtime_event');
  CALL `kt_migrate_bot_table`('qqbot_plugin_task_run', 'plugin_task_run');
  CALL `kt_migrate_bot_table`('qqbot_plugin_task', 'plugin_task');
  CALL `kt_migrate_bot_table`('qqbot_plugin', 'plugin');

  CALL `kt_migrate_bot_table`('qqbot_account_ability', 'bot_account_ability');
  CALL `kt_migrate_bot_table`('qqbot_connection_session', 'bot_connection_session');
  CALL `kt_migrate_bot_table`('qqbot_capability_binding', 'bot_capability_binding');
  CALL `kt_migrate_bot_table`('qqbot_permission_policy', 'bot_permission_policy');
  CALL `kt_migrate_bot_table`('qqbot_allowlist', 'bot_allowlist');
  CALL `kt_migrate_bot_table`('qqbot_blocklist', 'bot_blocklist');
  CALL `kt_migrate_bot_table`('qqbot_command_alias', 'bot_command_alias');
  CALL `kt_migrate_bot_table`('qqbot_command_log', 'bot_command_log');
  CALL `kt_migrate_bot_table`('qqbot_command', 'bot_command');
  CALL `kt_migrate_bot_table`('qqbot_config', 'bot_config');
  CALL `kt_migrate_bot_table`('qqbot_rule', 'bot_rule');
  CALL `kt_migrate_bot_table`('qqbot_message', 'bot_message');
  CALL `kt_migrate_bot_table`('qqbot_conversation', 'bot_conversation');
  CALL `kt_migrate_bot_table`('qqbot_send_log', 'bot_send_log');
  CALL `kt_migrate_bot_table`('qqbot_send_task', 'bot_send_task');
  CALL `kt_migrate_bot_table`('qqbot_dedupe_event', 'bot_dedupe_event');
  CALL `kt_migrate_bot_table`('qqbot_dedupe', 'bot_dedupe');
  CALL `kt_migrate_bot_table`('qqbot_message_delivery', 'bot_message_delivery');
  CALL `kt_migrate_bot_table`(
    'qqbot_message_publish_target',
    'bot_message_publish_target'
  );
  CALL `kt_migrate_bot_table`(
    'qqbot_message_publish_binding',
    'bot_message_publish_binding'
  );
  CALL `kt_migrate_bot_table`(
    'qqbot_napcat_webui_gateway_audit',
    'napcat_webui_gateway_audit'
  );
  CALL `kt_migrate_bot_table`('qqbot_account', 'bot_account');

  CREATE TABLE IF NOT EXISTS `tencent_bot_plugin_binding` (
    `id` BIGINT NOT NULL,
    `account_id` BIGINT NOT NULL,
    `plugin_key` VARCHAR(128) NOT NULL,
    `enabled` TINYINT(1) NOT NULL DEFAULT 1,
    `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_tencent_bot_plugin_binding` (`account_id`, `plugin_key`),
    KEY `idx_tencent_bot_plugin_binding_account_enabled` (`account_id`, `enabled`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  CALL `kt_migrate_tencent_plugin_binding`();
  CALL `kt_migrate_bot_subscription_key`();
  CALL `kt_retire_legacy_message_tables`();

  UPDATE `napcat_container`
  SET `reverse_ws_url` = REPLACE(
    `reverse_ws_url`,
    '/qqbot/onebot/reverse',
    '/bot-adapter/napcat/onebot/reverse'
  )
  WHERE `reverse_ws_url` LIKE '%/qqbot/onebot/reverse%';

  ALTER TABLE `bot_conversation`
    MODIFY COLUMN `last_message_id` VARCHAR(255) NULL;
  ALTER TABLE `bot_message`
    MODIFY COLUMN `message_id` VARCHAR(255) NULL;
  ALTER TABLE `bot_send_log`
    MODIFY COLUMN `message_id` VARCHAR(255) NULL;

  SET FOREIGN_KEY_CHECKS = previous_foreign_key_checks;
  SET SESSION group_concat_max_len = previous_group_concat_max_len;
END$$

DELIMITER ;

CALL `kt_migrate_bot_adapter_protocol_v1`();

DROP PROCEDURE `kt_migrate_bot_adapter_protocol_v1`;
DROP PROCEDURE `kt_migrate_bot_subscription_key`;
DROP PROCEDURE `kt_retire_legacy_message_tables`;
DROP PROCEDURE `kt_migrate_tencent_plugin_binding`;
DROP PROCEDURE `kt_migrate_bot_table`;
DROP PROCEDURE `kt_normalize_bot_index_names`;
