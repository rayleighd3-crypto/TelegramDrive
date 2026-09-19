import { pgTable, uuid, text, timestamp, bigint, boolean, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

// Auth + session per user (Telegram login flow)
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  phone: text("phone").notNull(),
  tgSession: text("tg_session"), // StringSession (encrypted-at-rest by app layer)
  storageChannelId: bigint("storage_channel_id", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Login flow state (phone -> pending code hash)
export const loginSessions = pgTable("login_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  phone: text("phone").notNull(),
  phoneCodeHash: text("phone_code_hash"),
  status: text("status").notNull().default("pending"), // pending | awaiting_password | done
  signedSession: text("signed_session"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Virtual filesystem index. Each file = N Telegram messages (parts).
export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  parentId: uuid("parent_id"), // null = root
  name: text("name").notNull(),
  isFolder: boolean("is_folder").notNull().default(false),
  size: bigint("size", { mode: "number" }),
  mime: text("mime"),
  // ordered list of in-part message ids (MTProto message ids in user channel)
  partMessageIds: jsonb("part_message_ids").$type<number[]>(),
  partSize: integer("part_size"), // bytes per part (all but last)
  uploadedParts: integer("uploaded_parts").notNull().default(0),
  sha256: text("sha256"),
  trashed: boolean("trashed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t: { parentId: any; name: any; userId: any }) => ({
  uniqPath: uniqueIndex("uniq_sibling_name").on(t.parentId, t.name, t.userId),
}));

//Part uploads in progress (for resumability)
export const uploadSessions = pgTable("upload_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  fileId: uuid("file_id"),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  size: bigint("size", { mode: "number" }).notNull(),
  partSize: integer("part_size").notNull(),
  messageIds: jsonb("message_ids").$type<number[]>().notNull().default([]),
  status: text("status").notNull().default("open"), // open | done | failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
