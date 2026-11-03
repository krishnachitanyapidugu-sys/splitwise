-- Splitwise database schema (MySQL 8). `npm run db:reset` applies it and re-seeds the baseline users.
--
-- Foreign keys are RESTRICT on purpose: deleting a group that still has expenses fails instead of silently
-- removing money records.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS email_outbox;
DROP TABLE IF EXISTS api_tokens;
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS expense_splits;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS group_members;
DROP TABLE IF EXISTS expense_groups;
DROP TABLE IF EXISTS friendships;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id INT NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(120) NOT NULL,
  password_hash VARCHAR(100) NULL,
  default_currency CHAR(3) NOT NULL DEFAULT 'INR',
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_email_key (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE friendships (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  friend_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY friendships_pair_key (user_id, friend_id),
  CONSTRAINT fk_friendships_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_friendships_friend FOREIGN KEY (friend_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- "groups" is a reserved word in MySQL 8.
CREATE TABLE expense_groups (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  group_type VARCHAR(20) NOT NULL DEFAULT 'OTHER',
  created_by INT NOT NULL,
  simplify_debts TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_groups_creator FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE group_members (
  id INT NOT NULL AUTO_INCREMENT,
  group_id INT NOT NULL,
  user_id INT NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'MEMBER',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY group_members_group_user_key (group_id, user_id),
  CONSTRAINT fk_members_group FOREIGN KEY (group_id) REFERENCES expense_groups (id),
  CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE expenses (
  id INT NOT NULL AUTO_INCREMENT,
  group_id INT NULL,
  paid_by INT NOT NULL,
  description VARCHAR(200) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  category VARCHAR(30) NULL,
  expense_date DATE NOT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY expenses_group_idx (group_id),
  CONSTRAINT fk_expenses_group FOREIGN KEY (group_id) REFERENCES expense_groups (id),
  CONSTRAINT fk_expenses_payer FOREIGN KEY (paid_by) REFERENCES users (id),
  CONSTRAINT fk_expenses_creator FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE expense_splits (
  id INT NOT NULL AUTO_INCREMENT,
  expense_id INT NOT NULL,
  user_id INT NOT NULL,
  share_amount DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY expense_splits_expense_user_key (expense_id, user_id),
  CONSTRAINT fk_splits_expense FOREIGN KEY (expense_id) REFERENCES expenses (id),
  CONSTRAINT fk_splits_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE settlements (
  id INT NOT NULL AUTO_INCREMENT,
  group_id INT NULL,
  payer_id INT NOT NULL,
  payee_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  note VARCHAR(200) NULL,
  settled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_settlements_group FOREIGN KEY (group_id) REFERENCES expense_groups (id),
  CONSTRAINT fk_settlements_payer FOREIGN KEY (payer_id) REFERENCES users (id),
  CONSTRAINT fk_settlements_payee FOREIGN KEY (payee_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE api_tokens (
  id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  token VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY api_tokens_token_key (token),
  CONSTRAINT fk_tokens_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Emails the app sends. In development they are only stored here and shown at /dev/mailbox.
CREATE TABLE email_outbox (
  id INT NOT NULL AUTO_INCREMENT,
  to_email VARCHAR(190) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY email_outbox_to_idx (to_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
