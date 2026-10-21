export type AiMode = "off" | "draft" | "send";

export type AutoReply = { enabled: boolean; subject: string; body: string; days: number; start?: string; end?: string };

export type Address = {
  id: number; local: string; email: string; label: string; isPrimary: boolean; aiMode: AiMode; autoReply?: AutoReply | null;
  /** The name it sends as; empty means the company's name. */
  displayName?: string;
};

export type Company = {
  id: string; name: string; domain: string; email: string; color: string; signature: string; addresses: Address[];
};

export type Me = {
  owner: { id: number; email: string; name: string };
  companies: Company[];
  mailDomain: string;
  hosts: { mx: string; smtp: string; imap: string; spfInclude: string };
  setupMissing: string[];
};

export type Condition = { field: "from" | "to" | "subject" | "body" | "header" | "attachment"; op: "contains" | "is" | "starts" | "ends" | "not-contains"; value: string; header?: string };
export type Action = { type: "move" | "label" | "read" | "star" | "forward" | "delete" | "stop"; value?: string };
export type Rule = { id?: number; name: string; enabled: boolean; match: "all" | "any"; conditions: Condition[]; actions: Action[] };

export type DnsRecord = {
  kind: "MX" | "SPF" | "DKIM" | "DMARC" | "SRV"; type: string; name: string; host: string; value: string; priority?: number;
  required: boolean; why: string; status?: "ok" | "missing" | "differs" | "unknown"; current?: string[]; note?: string;
};

export type Provider = { id: number; name: string; kind: "anthropic" | "openai"; baseUrl: string; model: string; keyHint: string };
export type Preset = { id: string; name: string; kind: "anthropic" | "openai"; baseUrl: string; model?: string; keyless?: boolean; hint: string };

export type Profile = {
  about: string; voice: string; knowledge: string; policies: string; signature: string;
  replyLanguage: "sender" | "english"; sendDelayMinutes: number; maxAutoPerSenderPerDay: number;
};

export type AiRun = {
  id: number; company_id: string; address: string | null; message_id: string | null; email_id: string | null; thread_id: string | null;
  sender: string | null; subject: string | null; mode: string | null; status: string; reason: string | null; draft_id: string | null; created_at: number;
};

// ---- JMAP mail objects (the subset the app reads) ----
export type EmailAddress = { name?: string | null; email: string };

export type Mailbox = {
  id: string; name: string; parentId: string | null; role: string | null; sortOrder: number;
  totalEmails: number; unreadEmails: number; totalThreads: number; unreadThreads: number;
};

export type BodyPart = { partId?: string; blobId?: string; type: string; name?: string | null; size?: number; cid?: string | null; disposition?: string | null };

export type Email = {
  id: string; threadId: string; mailboxIds: Record<string, boolean>; keywords: Record<string, boolean>;
  from?: EmailAddress[] | null; to?: EmailAddress[] | null; cc?: EmailAddress[] | null; bcc?: EmailAddress[] | null; replyTo?: EmailAddress[] | null;
  subject?: string | null; preview?: string; receivedAt: string; sentAt?: string | null; size?: number;
  hasAttachment?: boolean; messageId?: string[] | null; references?: string[] | null; inReplyTo?: string[] | null;
  textBody?: BodyPart[]; htmlBody?: BodyPart[]; attachments?: BodyPart[]; bodyValues?: Record<string, { value: string }>;
};

export type Identity = { id: string; name: string; email: string; replyTo?: EmailAddress[] | null; textSignature?: string; htmlSignature?: string };

// ---- Sending (Postal, through postal-bridge) ----
export type SendStats = {
  sent24h?: number; bounced24h?: number; received24h?: number; held?: number; queued?: number; bounceRate?: number;
  daily?: { day: string; sent: number; bounced: number }[]; statsError?: string;
};
export type SendRecordStatus = { status: string | null; error: string | null };
export type SendDomain = {
  id: string; name: string; verified: boolean; checkedAt: string | null;
  status: { spf: SendRecordStatus; dkim: SendRecordStatus; returnPath: SendRecordStatus; mx: SendRecordStatus };
  records: { kind: string; type: string; host: string; value: string; priority?: number; required: boolean; why: string }[];
};
export type SendKey = { id: number; name: string; type: "SMTP" | "API" | "SMTP-IP"; key: string; hold: boolean; lastUsedAt: string | null; createdAt: string | null };
export type SendApp = SendStats & {
  id: string; name: string; mode: "Live" | "Development"; suspended: boolean; smtpUsername: string; domains: number; credentials: number;
  domainList?: SendDomain[]; credentialList?: SendKey[];
};
export type SendOverview = {
  organization: { name: string; permalink: string };
  smtp: { host: string; port: number; security: string };
  api: { url: string; header: string };
  dns: { spfInclude: string; returnPath: string };
  servers: SendApp[];
};
export type SendMessage = {
  id: number; token: string; scope: string; to: string; from: string; subject: string | null; status: string; held: boolean; spam: boolean;
  bounce: boolean; tag: string | null; timestamp: string | null; lastDeliveryAttempt: string | null;
  deliveries?: { status: string; details: string | null; output: string | null; sentWithSsl: boolean; time: number | null; timestamp: string | null }[];
  raw?: boolean; body?: string | null; messageId?: string | null; queued?: boolean;
};
export type SendPage<T> = { page: number; totalPages: number; total: number } & T;

// ---- Contact forms (server/forms.ts, the forms service) ----
export type FormAuto = { subject: string; text: string };
export type ContactForm = {
  id: number; name: string; addressId: number; email: string; label: string;
  /** The public id in the URL, and the whole address a site's form posts to. */
  key: string; endpoint: string;
  appId: string; appName: string; keyHint: string;
  origins: string[]; redirect: string; subject: string; autoreply: FormAuto | null;
  limits: { perMinute: number; perDay: number }; enabled: boolean; createdAt: number; updatedAt: number;
};
export type FormsPage = { ready: boolean; endpointBase: string; domain: string; forms: ContactForm[] };
export type FormSending = {
  apps: { id: string; name: string; mode: string; domain: SendDomain | null }[];
  suggested: string; domain: string; companyName: string;
};
export type FormSubmission = {
  id: string; at: string; status: string; ip?: string; page?: string; agent?: string;
  fields: Record<string, string>; reason?: string; message_id?: string;
};

// An app's Users tab: its own database's users (server/appUsers.ts).
export type UserMapping = { schema: string; table: string; name?: string; email?: string; phone?: string; gender?: string; created?: string; onboarded?: string; lastUsed?: string };
/** Where a Supabase app keeps the names (and gender) it collects: a table, its user-id column, and its columns. */
export type ProfileMap = { schema: string; table: string; key: string; name?: string; nameLast?: string; gender?: string; onboardedAt?: string; onboarded?: string; lastSeen?: string };
export type UserSource = { connected: false } | { connected: true; kind: "supabase" | "table"; hint: string; mapping: UserMapping | null; profile: ProfileMap | null; updatedAt: number };
export type UserTable = { schema: string; table: string; columns: { name: string; type: string }[]; guess: UserMapping };
export type UserInspect = { hint: string; supabase: boolean; profile: ProfileMap | null; tables: UserTable[] };
export type AppUser = { name: string | null; gender: string | null; email: string | null; phone: string | null; provider: string | null; createdAt: string | null; onboardedAt: string | null; onboarded: boolean | null; lastUsedAt: string | null };
export type AppUsersPage = SendPage<{ users: AppUser[]; counts: { total: number; new30: number; active7: number; onboarded: number }; fields: { gender: boolean; onboarded: boolean; onboardedDate: boolean } }>;
